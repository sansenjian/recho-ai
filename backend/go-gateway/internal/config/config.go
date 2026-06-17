package config

import (
	"os"
	"strconv"
	"strings"
)

// Server config
var Port = parseEnvInt("PORT", 3000)

// CORS config
var CorsOrigin = parseEnvString("CORS_ORIGIN", "http://localhost:5173")

// Supabase config
var SupabaseURL = os.Getenv("SUPABASE_URL")
var SupabasePublishableKey = firstNonEmpty(
	os.Getenv("SUPABASE_PUBLISHABLE_KEY"),
	os.Getenv("SUPABASE_ANON_KEY"),
	os.Getenv("VITE_SUPABASE_PUBLISHABLE_KEY"),
	os.Getenv("VITE_SUPABASE_ANON_KEY"),
)
var SupabaseServiceRoleKey = os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
var SupabaseJWTSecret = os.Getenv("SUPABASE_JWT_SECRET")
var SupabaseImageBucket = parseEnvString("SUPABASE_IMAGE_BUCKET", "recho-images")

// Image generation config
var ImageGenAPIKey = os.Getenv("IMAGE_GEN_API_KEY")
var ImageGenBaseURL = parseEnvString("IMAGE_GEN_BASE_URL", "https://lucen.plus/v1")
var ImageCreditCostPerImage = parseEnvFloat("IMAGE_CREDIT_COST_PER_IMAGE", 0.5)
var ImageResponsesModel = parseEnvString("IMAGE_RESPONSES_MODEL", "gpt-image-2")
var ImageResponsesImageModel = parseEnvString("IMAGE_RESPONSES_IMAGE_MODEL", "gpt-image-2")

// Analytics config
var ImageAnalyticsEnabled = parseEnvBool("IMAGE_ANALYTICS_ENABLED", false)
var ImageEventsEnabled = parseEnvBool("IMAGE_EVENTS_ENABLED", false)
var CanvasContextEnabled = parseEnvBool("CANVAS_CONTEXT_ENABLED", false)
var FreeGenerationEnabled = parseEnvBool("FREE_GENERATION_ENABLED", true)
var GuestGenerationEnabled = parseEnvBool("GUEST_GENERATION_ENABLED", true)

// Admin config
var AdminUserIDs = parseEnvStringSlice("ADMIN_USER_IDS", ",")
var AdminUserEmails = parseEnvStringSlice("ADMIN_USER_EMAILS", ",")

func CorsOrigins() []string {
	origins := parseEnvStringSlice("CORS_ORIGIN", ",")
	if len(origins) == 0 {
		return []string{"http://localhost:5173"}
	}
	return origins
}

func IsProduction() bool {
	for _, origin := range CorsOrigins() {
		if origin != "" && !strings.Contains(origin, "localhost") && !strings.Contains(origin, "127.0.0.1") {
			return true
		}
	}
	return false
}

func firstNonEmpty(values ...string) string {
	for _, val := range values {
		if val != "" {
			return val
		}
	}
	return ""
}

func parseEnvString(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func parseEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if intVal, err := strconv.Atoi(val); err == nil {
			return intVal
		}
	}
	return defaultVal
}

func parseEnvFloat(key string, defaultVal float64) float64 {
	if val := os.Getenv(key); val != "" {
		if floatVal, err := strconv.ParseFloat(val, 64); err == nil {
			return floatVal
		}
	}
	return defaultVal
}

func parseEnvBool(key string, defaultVal bool) bool {
	if val := os.Getenv(key); val != "" {
		return strings.ToLower(val) == "true" || val == "1"
	}
	return defaultVal
}

func parseEnvStringSlice(key, sep string) []string {
	if val := os.Getenv(key); val != "" {
		parts := strings.Split(val, sep)
		result := make([]string, 0, len(parts))
		for _, p := range parts {
			if p = strings.TrimSpace(p); p != "" {
				result = append(result, p)
			}
		}
		return result
	}
	return nil
}
