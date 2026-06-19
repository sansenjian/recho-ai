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

	resetJWKSForTest(server.URL)
	defer resetJWKSForTest("")

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

func resetJWKSForTest(url string) {
	jwksMu.Lock()
	defer jwksMu.Unlock()
	jwksURL = url
	jwksExpiresAt = time.Time{}
	jwksKeys = nil
}
