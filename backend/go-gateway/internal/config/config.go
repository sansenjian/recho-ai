package config

import (
	"os"
	"strconv"
	"strings"
)

// Server config
var Port = parseEnvInt("PORT", 3000)
var AppEnv = FirstNonEmpty(
	os.Getenv("APP_ENV"),
	os.Getenv("GO_ENV"),
	os.Getenv("NODE_ENV"),
)

// CORS config
var CorsOrigin = parseEnvString("CORS_ORIGIN", "http://localhost:5173")

// Supabase config
var SupabaseURL = os.Getenv("SUPABASE_URL")
var SupabasePublishableKey = FirstNonEmpty(
	os.Getenv("SUPABASE_PUBLISHABLE_KEY"),
	os.Getenv("SUPABASE_ANON_KEY"),
	os.Getenv("VITE_SUPABASE_PUBLISHABLE_KEY"),
	os.Getenv("VITE_SUPABASE_ANON_KEY"),
)
var SupabaseServiceRoleKey = os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
var SupabaseJWKSURL = FirstNonEmpty(
	os.Getenv("SUPABASE_JWKS_URL"),
	jwksURLFromSupabaseURL(SupabaseURL),
)
// SupabaseJWTIssuer is the expected JWT `iss` claim. Defaults to SUPABASE_JWT_ISSUER,
// falling back to SUPABASE_URL. When empty (e.g. in tests/local dev), issuer
// validation is skipped.
var SupabaseJWTIssuer = FirstNonEmpty(
	os.Getenv("SUPABASE_JWT_ISSUER"),
	os.Getenv("SUPABASE_URL"),
)
var SupabaseImageBucket = parseEnvString("SUPABASE_IMAGE_BUCKET", "recho-images")

// Tencent COS config
var TencentCosSecretID = os.Getenv("TENCENT_COS_SECRET_ID")
var TencentCosSecretKey = os.Getenv("TENCENT_COS_SECRET_KEY")
var TencentCosBucket = os.Getenv("TENCENT_COS_BUCKET")
var TencentCosAppID = os.Getenv("TENCENT_COS_APPID")
var TencentCosFullBucket = resolveTencentCosBucket(TencentCosBucket, TencentCosAppID)
var TencentCosRegion = os.Getenv("TENCENT_COS_REGION")
var TencentCosPublicBaseURL = os.Getenv("TENCENT_COS_PUBLIC_BASE_URL")

func resolveTencentCosBucket(bucket, appID string) string {
	bucket = strings.TrimSpace(bucket)
	appID = strings.TrimSpace(appID)
	if bucket == "" {
		return ""
	}
	if appID == "" || strings.HasSuffix(bucket, "-"+appID) {
		return bucket
	}
	return bucket + "-" + appID
}

// Image generation config
var ImageGenAPIKey = os.Getenv("IMAGE_GEN_API_KEY")
var ImageGenBaseURL = parseEnvString("IMAGE_GEN_BASE_URL", "https://lucen.plus/v1")
var ImageCreditCostPerImage = parseEnvFloat("IMAGE_CREDIT_COST_PER_IMAGE", 0.5)
var ImageResponsesModel = parseEnvString("IMAGE_RESPONSES_MODEL", "gpt-image-2")
var ImageResponsesImageModel = parseEnvString("IMAGE_RESPONSES_IMAGE_MODEL", "gpt-image-2")

// Chat and analytics config. Chat is optional while Go runs as an image sidecar.
var ChatBaseURL = FirstNonEmpty(
	os.Getenv("CHAT_BASE_URL"),
	os.Getenv("ANALYSIS_URL"),
)
var ChatAPIKey = FirstNonEmpty(
	os.Getenv("CHAT_API_KEY"),
	os.Getenv("ANALYSIS_API_KEY"),
)
var AnalysisURL = os.Getenv("ANALYSIS_URL")

// Analytics config
var ImageAnalyticsEnabled = parseEnvBool("IMAGE_ANALYTICS_ENABLED", false)
var ImageEventsEnabled = parseEnvBool("IMAGE_EVENTS_ENABLED", false)
var CanvasContextEnabled = parseEnvBool("CANVAS_CONTEXT_ENABLED", false)
var FreeGenerationEnabled = parseEnvBool("FREE_GENERATION_ENABLED", true)
var GuestGenerationEnabled = parseEnvBool("GUEST_GENERATION_ENABLED", true)

// Admin config
var AdminUserIDs = parseEnvStringSlice("ADMIN_USER_IDS", ",")
var AdminUserEmails = parseEnvStringSlice("ADMIN_USER_EMAILS", ",")

// Diagnostics config — opt-in via ENABLE_DIAGNOSTICS=true. When disabled, the
// /api/image/diagnostics endpoint is not registered at all.
var EnableDiagnostics = parseEnvBool("ENABLE_DIAGNOSTICS", false)

func CorsOrigins() []string {
	origins := parseEnvStringSlice("CORS_ORIGIN", ",")
	if len(origins) == 0 {
		return []string{"http://localhost:5173"}
	}
	return origins
}

func IsProduction() bool {
	env := strings.ToLower(strings.TrimSpace(AppEnv))
	return env == "production" || env == "prod"
}

func FirstNonEmpty(values ...string) string {
	for _, val := range values {
		if trimmed := strings.TrimSpace(val); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func jwksURLFromSupabaseURL(value string) string {
	base := strings.TrimRight(strings.TrimSpace(value), "/")
	if base == "" {
		return ""
	}
	return base + "/auth/v1/.well-known/jwks.json"
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
