package response

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestErrorPreservesMessageAndAddsStableCode(t *testing.T) {
	tests := []struct {
		status int
		code   string
	}{
		{http.StatusBadRequest, "BAD_REQUEST"},
		{http.StatusUnauthorized, "UNAUTHORIZED"},
		{http.StatusPaymentRequired, "PAYMENT_REQUIRED"},
		{http.StatusForbidden, "FORBIDDEN"},
		{http.StatusNotFound, "NOT_FOUND"},
		{http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED"},
		{http.StatusRequestTimeout, "REQUEST_TIMEOUT"},
		{http.StatusConflict, "CONFLICT"},
		{http.StatusRequestEntityTooLarge, "REQUEST_BODY_TOO_LARGE"},
		{http.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE"},
		{http.StatusUnprocessableEntity, "UNPROCESSABLE_ENTITY"},
		{http.StatusTooManyRequests, "RATE_LIMITED"},
		{http.StatusInternalServerError, "INTERNAL_ERROR"},
		{http.StatusBadGateway, "BAD_GATEWAY"},
		{http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE"},
		{http.StatusGatewayTimeout, "GATEWAY_TIMEOUT"},
		{http.StatusTeapot, "HTTP_ERROR"},
	}

	for _, test := range tests {
		t.Run(test.code, func(t *testing.T) {
			rec := httptest.NewRecorder()

			Error(rec, test.status, "existing message")

			if rec.Code != test.status {
				t.Fatalf("expected status %d, got %d", test.status, rec.Code)
			}
			if got := rec.Header().Get("Content-Type"); got != "application/json" {
				t.Fatalf("expected JSON content type, got %q", got)
			}
			var body map[string]string
			if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
				t.Fatalf("decode error response: %v", err)
			}
			if len(body) != 2 || body["error"] != "existing message" || body["code"] != test.code {
				t.Fatalf("unexpected error body: %#v", body)
			}
		})
	}
}

func TestErrorBodyCanBeReusedForPersistedResponses(t *testing.T) {
	body := ErrorBody(http.StatusConflict, "existing message")

	if body.Error != "existing message" || body.Code != "CONFLICT" {
		t.Fatalf("unexpected reusable error body: %#v", body)
	}
}
