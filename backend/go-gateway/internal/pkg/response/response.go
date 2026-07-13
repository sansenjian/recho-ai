package response

import (
	"encoding/json"
	"net/http"
)

// Response is the standard API response wrapper
type Response struct {
	Data  any    `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}

// ErrorResponse preserves the public error message and adds a stable code.
type ErrorResponse struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

// CreditBalance represents a user's credit balance
type CreditBalance struct {
	Balance *float64 `json:"balance"`
}

// ImageGenerationResponse represents the image generation response
type ImageGenerationResponse struct {
	Images        []any          `json:"images"`
	CreditBalance *CreditBalance `json:"creditBalance,omitempty"`
}

// HealthResponse represents the health check response
type HealthResponse struct {
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}

// Error sends an error response
func Error(w http.ResponseWriter, status int, message string) {
	JSON(w, status, ErrorBody(status, message))
}

// ErrorWithCode sends a stable domain code while preserving the standard
// public error envelope.
func ErrorWithCode(w http.ResponseWriter, status int, code, message string) {
	if code == "" {
		code = errorCodeForStatus(status)
	}
	JSON(w, status, ErrorResponse{Error: message, Code: code})
}

// ErrorBody builds the same error envelope for direct and persisted responses.
func ErrorBody(status int, message string) ErrorResponse {
	return ErrorResponse{
		Error: message,
		Code:  errorCodeForStatus(status),
	}
}

func errorCodeForStatus(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "BAD_REQUEST"
	case http.StatusUnauthorized:
		return "UNAUTHORIZED"
	case http.StatusPaymentRequired:
		return "PAYMENT_REQUIRED"
	case http.StatusForbidden:
		return "FORBIDDEN"
	case http.StatusNotFound:
		return "NOT_FOUND"
	case http.StatusMethodNotAllowed:
		return "METHOD_NOT_ALLOWED"
	case http.StatusRequestTimeout:
		return "REQUEST_TIMEOUT"
	case http.StatusConflict:
		return "CONFLICT"
	case http.StatusRequestEntityTooLarge:
		return "REQUEST_BODY_TOO_LARGE"
	case http.StatusUnsupportedMediaType:
		return "UNSUPPORTED_MEDIA_TYPE"
	case http.StatusUnprocessableEntity:
		return "UNPROCESSABLE_ENTITY"
	case http.StatusTooManyRequests:
		return "RATE_LIMITED"
	case http.StatusInternalServerError:
		return "INTERNAL_ERROR"
	case http.StatusBadGateway:
		return "BAD_GATEWAY"
	case http.StatusServiceUnavailable:
		return "SERVICE_UNAVAILABLE"
	case http.StatusGatewayTimeout:
		return "GATEWAY_TIMEOUT"
	default:
		return "HTTP_ERROR"
	}
}

// JSON sends a JSON response
func JSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// Success sends a success response with data
func Success(w http.ResponseWriter, data any) {
	JSON(w, http.StatusOK, data)
}

// Created sends a 201 response
func Created(w http.ResponseWriter, data any) {
	JSON(w, http.StatusCreated, data)
}

// NoContent sends a 204 response
func NoContent(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNoContent)
}
