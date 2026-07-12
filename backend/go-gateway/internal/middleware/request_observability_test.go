package middleware

import (
	"net/http"
	"net/http/httptest"
	"regexp"
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
