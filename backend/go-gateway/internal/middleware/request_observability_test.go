package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	chiMiddleware "github.com/go-chi/chi/v5/middleware"
)

var uuidV4Pattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestRequestIDPreservesValidIncomingID(t *testing.T) {
	responseID, headerID, contextID := serveRequestID(t, "req_go-123")

	if responseID != "req_go-123" {
		t.Fatalf("expected response request ID to be preserved, got %q", responseID)
	}
	if headerID != "req_go-123" {
		t.Fatalf("expected downstream request header to be preserved, got %q", headerID)
	}
	if contextID != "req_go-123" {
		t.Fatalf("expected chi request context ID to be preserved, got %q", contextID)
	}
}

func TestRequestIDTrimsValidIncomingID(t *testing.T) {
	responseID, headerID, contextID := serveRequestID(t, "  req_go-trimmed  ")

	for name, got := range map[string]string{
		"response": responseID,
		"header":   headerID,
		"context":  contextID,
	} {
		if got != "req_go-trimmed" {
			t.Fatalf("expected trimmed %s request ID, got %q", name, got)
		}
	}
}

func TestRequestIDReplacesInvalidIncomingID(t *testing.T) {
	responseID, headerID, contextID := serveRequestID(t, "invalid request id")

	assertGeneratedRequestID(t, responseID)
	if headerID != responseID || contextID != responseID {
		t.Fatalf("expected one correlated ID, got response=%q header=%q context=%q", responseID, headerID, contextID)
	}
}

func TestRequestIDGeneratesReusableIDWhenMissing(t *testing.T) {
	generatedID, headerID, contextID := serveRequestID(t, "")

	assertGeneratedRequestID(t, generatedID)
	if headerID != generatedID || contextID != generatedID {
		t.Fatalf("expected one correlated ID, got response=%q header=%q context=%q", generatedID, headerID, contextID)
	}

	replayedID, replayedHeaderID, replayedContextID := serveRequestID(t, generatedID)
	if replayedID != generatedID || replayedHeaderID != generatedID || replayedContextID != generatedID {
		t.Fatalf("expected generated ID to be reusable, got response=%q header=%q context=%q", replayedID, replayedHeaderID, replayedContextID)
	}
}

func serveRequestID(t *testing.T, incomingID string) (responseID string, headerID string, contextID string) {
	t.Helper()

	handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		headerID = r.Header.Get("X-Request-ID")
		contextID = chiMiddleware.GetReqID(r.Context())
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/config/app", nil)
	if incomingID != "" {
		req.Header.Set("X-Request-ID", incomingID)
	}
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rec.Code)
	}
	return rec.Header().Get("X-Request-ID"), headerID, contextID
}

func assertGeneratedRequestID(t *testing.T, id string) {
	t.Helper()
	if !uuidV4Pattern.MatchString(id) {
		t.Fatalf("expected UUID v4 request ID, got %q", id)
	}
}

func TestRequestLoggerWritesSafeCompletionEvent(t *testing.T) {
	var output bytes.Buffer
	handler := RequestID(RequestLogger(&output)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})))
	req := httptest.NewRequest(http.MethodPost, "/api/config/app?secret=query-secret", strings.NewReader("body-secret"))
	req.Header.Set("X-Request-ID", "req_go_log")
	req.Header.Set("Authorization", "Bearer authorization-secret")
	req.Header.Set("Cookie", "session=cookie-secret")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	event := decodeRequestLog(t, output.String())
	expectedKeys := []string{
		"duration_ms",
		"event",
		"level",
		"method",
		"path",
		"request_id",
		"service",
		"status_code",
		"timestamp",
	}
	if len(event) != len(expectedKeys) {
		t.Fatalf("expected exact log fields %v, got %#v", expectedKeys, event)
	}
	for _, key := range expectedKeys {
		if _, ok := event[key]; !ok {
			t.Fatalf("expected log field %q in %#v", key, event)
		}
	}

	assertLogValue(t, event, "level", "info")
	assertLogValue(t, event, "service", "go-gateway")
	assertLogValue(t, event, "event", "request.completed")
	assertLogValue(t, event, "request_id", "req_go_log")
	assertLogValue(t, event, "method", http.MethodPost)
	assertLogValue(t, event, "path", "/api/config/app")
	assertLogValue(t, event, "status_code", float64(http.StatusNoContent))
	if duration, ok := event["duration_ms"].(float64); !ok || duration < 0 {
		t.Fatalf("expected non-negative duration_ms, got %#v", event["duration_ms"])
	}

	for _, secret := range []string{"query-secret", "authorization-secret", "cookie-secret", "body-secret"} {
		if strings.Contains(output.String(), secret) {
			t.Fatalf("request log leaked %q: %s", secret, output.String())
		}
	}
}

func TestRequestLoggerNormalizesImplicitSuccessToStatusOK(t *testing.T) {
	var output bytes.Buffer
	handler := RequestID(RequestLogger(&output)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})))
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("X-Request-ID", "req_go_default_status")

	handler.ServeHTTP(httptest.NewRecorder(), req)

	event := decodeRequestLog(t, output.String())
	assertLogValue(t, event, "status_code", float64(http.StatusOK))
}

func TestRequestLoggerRecordsRecoveredPanics(t *testing.T) {
	var output bytes.Buffer
	handler := RequestID(RequestLogger(&output)(chiMiddleware.Recoverer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("test panic")
	}))))
	req := httptest.NewRequest(http.MethodGet, "/api/panic", nil)
	req.Header.Set("X-Request-ID", "req_go_panic")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected recovered 500, got %d", rec.Code)
	}
	event := decodeRequestLog(t, output.String())
	assertLogValue(t, event, "request_id", "req_go_panic")
	assertLogValue(t, event, "status_code", float64(http.StatusInternalServerError))
}

func decodeRequestLog(t *testing.T, line string) map[string]any {
	t.Helper()
	decoder := json.NewDecoder(strings.NewReader(line))
	var event map[string]any
	if err := decoder.Decode(&event); err != nil {
		t.Fatalf("decode request log: %v; line=%q", err, line)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		t.Fatalf("expected one JSON log event, got %q", line)
	}
	return event
}

func assertLogValue(t *testing.T, event map[string]any, key string, want any) {
	t.Helper()
	if got := event[key]; got != want {
		t.Fatalf("expected %s=%#v, got %#v", key, want, got)
	}
}
