package middleware

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestAuthMiddlewareValidatesJWTWithJWKS(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	kid := "test-key"
	jwks := jwksResponse{Keys: []jwksKey{{
		KID: kid,
		KTY: "RSA",
		ALG: "RS256",
		N:   base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
		E:   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
	}}}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewEncoder(w).Encode(jwks); err != nil {
			t.Fatal(err)
		}
	}))
	defer server.Close()

	resetAuthForTest(server.URL, "", "")
	defer resetAuthForTest("", "", "")

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"sub":   "user_123",
		"email": "user@example.com",
		"role":  "authenticated",
		"exp":   time.Now().Add(time.Hour).Unix(),
	})
	token.Header["kid"] = kid
	tokenString, err := token.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}

	handler := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := GetUserFromRequest(r)
		if user == nil {
			t.Fatal("expected authenticated user")
		}
		if user.ID != "user_123" || user.Email != "user@example.com" || user.Role != "authenticated" {
			t.Fatalf("unexpected user: %+v", user)
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+tokenString)
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d body=%s", res.Code, res.Body.String())
	}
}

func TestAuthMiddlewareFallsBackToSupabaseAuthUser(t *testing.T) {
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/v1/user" {
			t.Fatalf("unexpected auth path: %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer legacy-token" {
			t.Fatalf("unexpected authorization header: %s", got)
		}
		if got := r.Header.Get("apikey"); got != "publishable-key" {
			t.Fatalf("unexpected apikey header: %s", got)
		}
		if err := json.NewEncoder(w).Encode(map[string]string{
			"id":    "user_456",
			"email": "legacy@example.com",
			"role":  "authenticated",
		}); err != nil {
			t.Fatal(err)
		}
	}))
	defer authServer.Close()

	resetAuthForTest("http://127.0.0.1:1/jwks", authServer.URL+"/auth/v1/user", "publishable-key")
	defer resetAuthForTest("", "", "")

	handler := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := GetUserFromRequest(r)
		if user == nil {
			t.Fatal("expected authenticated user")
		}
		if user.ID != "user_456" || user.Email != "legacy@example.com" || user.Role != "authenticated" {
			t.Fatalf("unexpected user: %+v", user)
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer legacy-token")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d body=%s", res.Code, res.Body.String())
	}
}

func resetAuthForTest(jwks, userURL, apiKey string) {
	jwksMu.Lock()
	defer jwksMu.Unlock()
	jwksURL = jwks
	authUserURL = userURL
	authAPIKey = apiKey
	jwksExpiresAt = time.Time{}
	jwksKeys = nil
}
