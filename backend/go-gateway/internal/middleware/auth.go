package middleware

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
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

var (
	jwksURL       string
	jwksMu        sync.Mutex
	jwksExpiresAt time.Time
	jwksKeys      map[string]any
)

// Init initializes Supabase JWT verification from the JWKS discovery endpoint.
// Call this from main() after config is loaded.
// In production, a JWKS URL is required.
func Init() {
	jwksURL = config.SupabaseJWKSURL

	if jwksURL == "" {
		if isProduction() {
			log.Fatal("FATAL: SUPABASE_URL or SUPABASE_JWKS_URL is required in production for JWT verification.")
		}
		log.Println("WARNING: Supabase JWKS URL not configured — JWT verification disabled, all requests will be unauthenticated")
	} else {
		log.Printf("Supabase JWKS verification configured: %s", jwksURL)
	}
}

// isProduction returns true when the configured app environment is production.
func isProduction() bool {
	return config.IsProduction()
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

		// If no JWKS URL is configured, skip verification (development only — Init() blocks this in production)
		if jwksURL == "" {
			next.ServeHTTP(w, r)
			return
		}

		// Parse and verify JWT with Supabase asymmetric signing keys.
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
			return jwksPublicKey(r.Context(), kid)
		})

		if err != nil || !token.Valid {
			// Token was provided but is invalid or expired — return 401
			response.Error(w, http.StatusUnauthorized, "token 无效或已过期，请重新登录。")
			return
		}

		// Extract claims
		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			response.Error(w, http.StatusUnauthorized, "token 格式无效。")
			return
		}

		// Extract user ID from "sub" claim
		sub, _ := claims["sub"].(string)
		if sub == "" {
			response.Error(w, http.StatusUnauthorized, "token 缺少用户标识。")
			return
		}

		user := &User{ID: sub}

		if email, ok := claims["email"].(string); ok {
			user.Email = email
		}
		if role, ok := claims["role"].(string); ok {
			user.Role = role
		}

		ctx := context.WithValue(r.Context(), userContextKey, user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
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
