package middleware

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"

	"go-gateway/internal/config"

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

// jwtSecret holds the Supabase JWT secret for HMAC-SHA256 verification
var jwtSecret []byte

// Init initializes the JWT secret from centralized config.
// Call this from main() after config is loaded.
// In production (non-localhost CORS), missing JWT secret is fatal.
func Init() {
	jwtSecret = []byte(config.SupabaseJWTSecret)

	if len(jwtSecret) == 0 {
		if isProduction() {
			log.Fatal("FATAL: SUPABASE_JWT_SECRET is required in production but not set. Refusing to start with authentication disabled.")
		}
		log.Println("WARNING: SUPABASE_JWT_SECRET not set — JWT verification disabled, all requests will be unauthenticated")
	} else {
		log.Println("Supabase JWT secret loaded successfully")
	}
}

// isProduction returns true when the CORS origin is not a localhost address
func isProduction() bool {
	origin := config.CorsOrigin
	return origin != "" &&
		!strings.Contains(origin, "localhost") &&
		!strings.Contains(origin, "127.0.0.1")
}

// AuthMiddleware validates Supabase JWT tokens using HMAC-SHA256 signature verification.
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

		// If no JWT secret is configured, skip verification (development only — Init() blocks this in production)
		if len(jwtSecret) == 0 {
			next.ServeHTTP(w, r)
			return
		}

		// Parse and verify JWT with HMAC-SHA256
		token, err := jwt.Parse(tokenString, func(t *jwt.Token) (any, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
			}
			return jwtSecret, nil
		})

		if err != nil || !token.Valid {
			// Token was provided but is invalid or expired — return 401
			http.Error(w, `{"error":"token 无效或已过期，请重新登录。"}`, http.StatusUnauthorized)
			return
		}

		// Extract claims
		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			http.Error(w, `{"error":"token 格式无效。"}`, http.StatusUnauthorized)
			return
		}

		// Extract user ID from "sub" claim
		sub, _ := claims["sub"].(string)
		if sub == "" {
			http.Error(w, `{"error":"token 缺少用户标识。"}`, http.StatusUnauthorized)
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

// RequireAuth requires authentication for the handler
func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := GetUserFromContext(r.Context())
		if user == nil || user.ID == "" {
			http.Error(w, `{"error":"请先登录后再使用额度。"}`, http.StatusUnauthorized)
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
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}

		if user.Role != "admin" && user.Role != "supabase_admin" {
			http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}
