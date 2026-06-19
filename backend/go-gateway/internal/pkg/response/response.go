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

// CreditBalance represents a user's credit balance
type CreditBalance struct {
	Balance *float64 `json:"balance"`
}

// ImageGenerationResponse represents the image generation response
type ImageGenerationResponse struct {
	Images       []any        `json:"images"`
	CreditBalance *CreditBalance `json:"creditBalance,omitempty"`
}

// HealthResponse represents the health check response
type HealthResponse struct {
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}

// Error sends an error response
func Error(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
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
