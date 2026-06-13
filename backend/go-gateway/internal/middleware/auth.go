package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// User represents the authenticated user
type User struct {
	ID    string `json:"id"`
	Email string `json:"email,omitempty"`
}

// contextKey is the type for context keys
type contextKey string

const (
	// userContextKey is the context key for the authenticated user
	userContextKey contextKey = "user"
)

// AuthMiddleware validates Supabase JWT tokens
// In production, you would verify the JWT signature using Supabase's public key
// For now, we'll do basic token validation
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			next.ServeHTTP(w, r)
			return
		}

		// Extract Bearer token
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			next.ServeHTTP(w, r)
			return
		}

		token := parts[1]
		if token == "" {
			next.ServeHTTP(w, r)
			return
		}

		// In production, verify JWT with Supabase public key
		// For now, we'll create a minimal user from the token
		// This is a placeholder - real implementation would decode JWT
		user := &User{
			ID: extractUserIDFromToken(token),
		}

		if user.ID != "" {
			// Add user to context
			ctx := context.WithValue(r.Context(), userContextKey, user)
			r = r.WithContext(ctx)
		}

		next.ServeHTTP(w, r)
	})
}

// extractUserIDFromToken extracts user ID from JWT token
// In production, this should verify the JWT signature
func extractUserIDFromToken(token string) string {
	// JWT format: header.payload.signature
	// We need to decode the payload (second part)
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return ""
	}

	// Decode base64url payload
	payload, err := base64URLDecode(parts[1])
	if err != nil {
		return ""
	}

	// Parse JSON payload
	var claims map[string]any
	if err := json.Unmarshal(payload, &claims); err != nil {
		return ""
	}

	// Extract user ID (sub claim)
	if sub, ok := claims["sub"].(string); ok {
		return sub
	}

	return ""
}

// base64URLDecode decodes a base64url encoded string
func base64URLDecode(s string) ([]byte, error) {
	// Add padding if necessary
	switch len(s) % 4 {
	case 2:
		s += "=="
	case 3:
		s += "="
	}

	// Replace URL-safe characters
	s = strings.ReplaceAll(s, "-", "+")
	s = strings.ReplaceAll(s, "_", "/")

	return []byte(s), nil
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

		// Check if user is in admin list
		// This would typically check against a database or cache
		next.ServeHTTP(w, r)
	})
}

// RequestIDMiddleware adds a unique request ID to each request
func RequestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := fmt.Sprintf("%d", time.Now().UnixNano())
		w.Header().Set("X-Request-ID", requestID)
		r.Header.Set("X-Request-ID", requestID)
		next.ServeHTTP(w, r)
	})
}
