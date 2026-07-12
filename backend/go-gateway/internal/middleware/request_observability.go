package middleware

import (
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync/atomic"
	"time"

	chiMiddleware "github.com/go-chi/chi/v5/middleware"
)

const requestIDHeader = "X-Request-ID"

var (
	requestIDPattern         = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)
	requestIDFallbackCounter atomic.Uint64
)

// RequestID validates or creates the public request ID, exposes it to the next
// handler and response, and keeps chi's request context compatible with
// middleware.GetReqID.
func RequestID(next http.Handler) http.Handler {
	expose := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := chiMiddleware.GetReqID(r.Context())
		r.Header.Set(requestIDHeader, id)
		w.Header().Set(requestIDHeader, id)
		next.ServeHTTP(w, r)
	})
	assign := chiMiddleware.RequestID(expose)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		candidate := strings.TrimSpace(r.Header.Get(requestIDHeader))
		if len(r.Header.Values(requestIDHeader)) != 1 || !requestIDPattern.MatchString(candidate) {
			candidate = newRequestID()
		}
		r.Header.Set(requestIDHeader, candidate)
		assign.ServeHTTP(w, r)
	})
}

func newRequestID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		fallback := fmt.Sprintf("%d:%d", time.Now().UnixNano(), requestIDFallbackCounter.Add(1))
		digest := sha256.Sum256([]byte(fallback))
		copy(value[:], digest[:len(value)])
	}

	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", value[0:4], value[4:6], value[6:8], value[8:10], value[10:16])
}
