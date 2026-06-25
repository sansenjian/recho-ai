package middleware

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"go-gateway/internal/config"
	"go-gateway/internal/pkg/response"

	"github.com/golang-jwt/jwt/v5"
)

// User represents the authenticated user
type User struct {
	ID    string `json:"id"`
	Email string `json:"email,omitempty"`
	Role  string `json:"role,omitempty"`
}

// contextKey is the type for context keys
type contextKey string

const (
	userContextKey contextKey = "user"
)

const jwksCacheTTL = 10 * time.Minute
const authHTTPTimeout = 5 * time.Second

var errAuthVerificationNotConfigured = errors.New("Supabase auth verification is not configured")

type jwksKey struct {
	KID string `json:"kid"`
	ALG string `json:"alg"`
	KTY string `json:"kty"`
	Use string `json:"use,omitempty"`
	N   string `json:"n,omitempty"`
	E   string `json:"e,omitempty"`
	Crv string `json:"crv,omitempty"`
	X   string `json:"x,omitempty"`
	Y   string `json:"y,omitempty"`
}

type jwksResponse struct {
	Keys []jwksKey `json:"keys"`
}

type supabaseUserResponse struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

var (
	jwksURL       string
	authUserURL   string
	authAPIKey    string
	authHTTP      = &http.Client{Timeout: authHTTPTimeout}
	jwksMu        sync.Mutex
	jwksExpiresAt time.Time
	jwksKeys      map[string]any
)

// Init initializes Supabase JWT verification from the JWKS discovery endpoint.
// Call this from main() after config is loaded.
// In production, a JWKS URL is required.
func Init() {
	jwksURL = config.SupabaseJWKSURL
	authUserURL = authUserURLFromSupabaseURL(config.SupabaseURL)
	authAPIKey = config.FirstNonEmpty(config.SupabasePublishableKey, config.SupabaseServiceRoleKey)
	authFallbackConfigured := authUserURL != "" && authAPIKey != ""
	authFallbackIncomplete := authUserURL != "" && authAPIKey == ""

	if authFallbackIncomplete {
		log.Println("WARNING: Supabase Auth user verification fallback is configured but disabled because SUPABASE_PUBLISHABLE_KEY or SUPABASE_SERVICE_ROLE_KEY is missing")
	}

	if jwksURL == "" && !authFallbackConfigured {
		if isProduction() {
			log.Fatal("FATAL: SUPABASE_JWKS_URL or SUPABASE_URL plus SUPABASE_PUBLISHABLE_KEY/SUPABASE_SERVICE_ROLE_KEY is required in production for JWT verification.")
		}
		log.Println("WARNING: Supabase auth verification not configured — all requests will be unauthenticated")
	} else {
		if jwksURL != "" {
			log.Printf("Supabase JWKS verification configured: %s", jwksURL)
		}
		if authFallbackConfigured {
			log.Printf("Supabase Auth user verification fallback configured: %s", authUserURL)
		}
	}
}

// isProduction returns true when the configured app environment is production.
func isProduction() bool {
	return config.IsProduction()
}

func authUserURLFromSupabaseURL(value string) string {
	base := strings.TrimRight(strings.TrimSpace(value), "/")
	if base == "" {
		return ""
	}
	return base + "/auth/v1/user"
}

// AuthMiddleware validates Supabase JWT tokens using Supabase JWKS public keys.
// When a Bearer token is present but fails verification, returns 401 instead of
// silently treating the request as unauthenticated.
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			next.ServeHTTP(w, r)
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
			next.ServeHTTP(w, r)
			return
		}

		tokenString := strings.TrimSpace(parts[1])
		if tokenString == "" {
			next.ServeHTTP(w, r)
			return
		}

		user, err := verifyBearerToken(r.Context(), tokenString)
		if err != nil || user == nil || user.ID == "" {
			response.Error(w, http.StatusUnauthorized, "token 无效或已过期，请重新登录。")
			return
		}

		ctx := context.WithValue(r.Context(), userContextKey, user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func verifyBearerToken(ctx context.Context, tokenString string) (*User, error) {
	if jwksURL != "" {
		user, err := verifyTokenWithJWKS(ctx, tokenString)
		if err == nil {
			return user, nil
		}
		log.Printf("[auth] JWKS verification failed, trying Supabase Auth fallback: %v", err)
	}

	if authUserURL != "" && authAPIKey != "" {
		return verifyTokenWithAuthServer(ctx, tokenString)
	}

	return nil, errAuthVerificationNotConfigured
}

func verifyTokenWithJWKS(ctx context.Context, tokenString string) (*User, error) {
	token, err := jwt.Parse(tokenString, func(t *jwt.Token) (any, error) {
		switch t.Method.(type) {
		case *jwt.SigningMethodRSA, *jwt.SigningMethodECDSA:
		default:
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}

		kid, _ := t.Header["kid"].(string)
		if kid == "" {
			return nil, fmt.Errorf("missing JWT key id")
		}
		return jwksPublicKey(ctx, kid)
	})
	if err != nil || !token.Valid {
		if err == nil {
			err = fmt.Errorf("invalid token")
		}
		return nil, err
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, fmt.Errorf("token claims are invalid")
	}

	sub, _ := claims["sub"].(string)
	if sub == "" {
		return nil, fmt.Errorf("token is missing subject")
	}

	// Validate issuer (iss) when an expected issuer is configured. The expected
	// issuer is sourced from SUPABASE_JWT_ISSUER (falling back to SUPABASE_URL).
	// When neither is set (e.g. tests/local dev) issuer validation is skipped.
	//
	// Security model: Supabase JWTs use iss="https://<project>.supabase.co/auth/v1"
	// while SUPABASE_URL is "https://<project>.supabase.co". We accept any iss that
	// either exactly matches the expected issuer or starts with
	// expected_issuer + "/", constraining to the same Supabase project origin.
	// This prevents tokens from unrelated Supabase projects from being accepted
	// while accommodating the "/auth/v1" suffix that Supabase appends.
	if expectedIssuer := config.SupabaseJWTIssuer; expectedIssuer != "" {
		iss, ok := claims["iss"].(string)
		if !ok || iss == "" {
			log.Printf("[auth] token iss claim missing or non-string")
			return nil, fmt.Errorf("token issuer missing")
		}
		normalizedExpected := strings.TrimRight(expectedIssuer, "/")
		if iss != normalizedExpected && !strings.HasPrefix(iss, normalizedExpected+"/") {
			log.Printf("[auth] token issuer mismatch: got %q, expected prefix %q", iss, normalizedExpected)
			return nil, fmt.Errorf("token issuer mismatch")
		}
	}

	// Validate audience (aud) when the claim is present. Supabase issues
	// "authenticated" as the audience for signed-in users.
	if audClaim, ok := claims["aud"]; ok && audClaim != nil {
		if !audContainsAuthenticated(audClaim) {
			log.Printf("[auth] token audience rejected: %v", audClaim)
			return nil, fmt.Errorf("token audience not allowed")
		}
	}

	user := &User{ID: sub}
	if email, ok := claims["email"].(string); ok {
		user.Email = email
	}
	if role, ok := claims["role"].(string); ok {
		user.Role = role
	}
	return user, nil
}

func verifyTokenWithAuthServer(ctx context.Context, tokenString string) (*User, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, authUserURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+tokenString)
	req.Header.Set("apikey", authAPIKey)

	resp, err := authHTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to verify token with Supabase Auth: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Supabase Auth token verification returned status %d", resp.StatusCode)
	}

	var user supabaseUserResponse
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, fmt.Errorf("failed to decode Supabase Auth user: %w", err)
	}
	if user.ID == "" {
		return nil, fmt.Errorf("Supabase Auth user response is missing id")
	}
	return &User{ID: user.ID, Email: user.Email, Role: user.Role}, nil
}

func jwksPublicKey(ctx context.Context, kid string) (any, error) {
	keys, err := cachedJWKSKeys(ctx)
	if err != nil {
		return nil, err
	}
	key, ok := keys[kid]
	if !ok {
		// Refresh once in case Supabase rotated keys after our cache fill.
		keys, err = fetchJWKSKeys(ctx, true)
		if err != nil {
			return nil, err
		}
		key, ok = keys[kid]
	}
	if !ok {
		return nil, fmt.Errorf("JWT signing key %q not found", kid)
	}
	return key, nil
}

func cachedJWKSKeys(ctx context.Context) (map[string]any, error) {
	jwksMu.Lock()
	if len(jwksKeys) > 0 && time.Now().Before(jwksExpiresAt) {
		keys := jwksKeys
		jwksMu.Unlock()
		return keys, nil
	}
	jwksMu.Unlock()

	return fetchJWKSKeys(ctx, false)
}

func fetchJWKSKeys(ctx context.Context, force bool) (map[string]any, error) {
	jwksMu.Lock()
	defer jwksMu.Unlock()

	if !force && len(jwksKeys) > 0 && time.Now().Before(jwksExpiresAt) {
		return jwksKeys, nil
	}

	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, jwksURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch Supabase JWKS: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Supabase JWKS returned status %d", resp.StatusCode)
	}

	var jwks jwksResponse
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return nil, fmt.Errorf("failed to decode Supabase JWKS: %w", err)
	}

	keys := make(map[string]any, len(jwks.Keys))
	for _, key := range jwks.Keys {
		publicKey, err := jwksPublicKeyFromKey(key)
		if err != nil {
			log.Printf("[auth] skipping unsupported JWKS key %q: %v", key.KID, err)
			continue
		}
		keys[key.KID] = publicKey
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("Supabase JWKS did not contain usable asymmetric signing keys")
	}

	jwksKeys = keys
	jwksExpiresAt = time.Now().Add(jwksCacheTTL)
	return jwksKeys, nil
}

func jwksPublicKeyFromKey(key jwksKey) (any, error) {
	if key.KID == "" {
		return nil, fmt.Errorf("missing kid")
	}
	switch key.KTY {
	case "RSA":
		return rsaPublicKey(key)
	case "EC":
		return ecPublicKey(key)
	default:
		return nil, fmt.Errorf("unsupported key type %q", key.KTY)
	}
}

func rsaPublicKey(key jwksKey) (*rsa.PublicKey, error) {
	nBytes, err := decodeBase64URLUInt(key.N)
	if err != nil {
		return nil, fmt.Errorf("invalid RSA modulus: %w", err)
	}
	eBytes, err := decodeBase64URLUInt(key.E)
	if err != nil {
		return nil, fmt.Errorf("invalid RSA exponent: %w", err)
	}

	exponent := 0
	for _, b := range eBytes {
		exponent = exponent<<8 + int(b)
	}
	if exponent <= 1 {
		return nil, fmt.Errorf("invalid RSA exponent")
	}

	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: exponent,
	}, nil
}

func ecPublicKey(key jwksKey) (*ecdsa.PublicKey, error) {
	curve, err := ellipticCurve(key.Crv)
	if err != nil {
		return nil, err
	}
	xBytes, err := decodeBase64URLUInt(key.X)
	if err != nil {
		return nil, fmt.Errorf("invalid EC x coordinate: %w", err)
	}
	yBytes, err := decodeBase64URLUInt(key.Y)
	if err != nil {
		return nil, fmt.Errorf("invalid EC y coordinate: %w", err)
	}

	x := new(big.Int).SetBytes(xBytes)
	y := new(big.Int).SetBytes(yBytes)
	if !curve.IsOnCurve(x, y) {
		return nil, fmt.Errorf("EC point is not on curve")
	}
	return &ecdsa.PublicKey{Curve: curve, X: x, Y: y}, nil
}

func ellipticCurve(name string) (elliptic.Curve, error) {
	switch name {
	case "P-256":
		return elliptic.P256(), nil
	case "P-384":
		return elliptic.P384(), nil
	case "P-521":
		return elliptic.P521(), nil
	default:
		return nil, fmt.Errorf("unsupported EC curve %q", name)
	}
}

func decodeBase64URLUInt(value string) ([]byte, error) {
	if value == "" {
		return nil, fmt.Errorf("empty value")
	}
	return base64.RawURLEncoding.DecodeString(value)
}

// allowedAudiences is the set of audience values that Supabase uses for
// signed-in users. Exact matches are required to prevent strings like
// "notauthenticated" from being accepted.
var allowedAudiences = map[string]bool{
	"authenticated": true,
}

// audContainsAuthenticated reports whether the `aud` claim includes one of the
// allowed audience values used by Supabase for signed-in users. The claim may
// be a single string or an array of strings per the JWT spec.
func audContainsAuthenticated(audClaim any) bool {
	switch v := audClaim.(type) {
	case string:
		return allowedAudiences[v]
	case []string:
		for _, a := range v {
			if allowedAudiences[a] {
				return true
			}
		}
	case []any:
		for _, a := range v {
			if s, ok := a.(string); ok && allowedAudiences[s] {
				return true
			}
		}
	}
	return false
}

// RequireAuth requires authentication for the handler
func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := GetUserFromContext(r.Context())
		if user == nil || user.ID == "" {
			response.Error(w, http.StatusUnauthorized, "请先登录后再使用额度。")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// GetUserFromContext retrieves the authenticated user from context
func GetUserFromContext(ctx context.Context) *User {
	val := ctx.Value(userContextKey)
	if val == nil {
		return nil
	}
	user, ok := val.(*User)
	if !ok {
		return nil
	}
	return user
}

// WithUser stores an authenticated user in a context.
func WithUser(ctx context.Context, user *User) context.Context {
	if user == nil {
		return ctx
	}
	return context.WithValue(ctx, userContextKey, user)
}

// GetUserFromRequest extracts user from http.Request context
func GetUserFromRequest(r *http.Request) *User {
	return GetUserFromContext(r.Context())
}

// AdminMiddleware checks if the user is an admin
func AdminMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := GetUserFromContext(r.Context())
		if user == nil || user.ID == "" {
			response.Error(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		if user.Role != "admin" && user.Role != "supabase_admin" {
			response.Error(w, http.StatusForbidden, "forbidden")
			return
		}

		next.ServeHTTP(w, r)
	})
}
