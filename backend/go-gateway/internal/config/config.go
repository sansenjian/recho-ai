package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

var _ = loadEnvFiles()

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
var SupabasePublishableKey = supabasePublishableKeyFromEnv()
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

// ImageJobWorkerEnabled controls the durable image persistence path. It is
// enabled by default after the image_generation_jobs migration is applied;
// set IMAGE_JOB_WORKER_ENABLED=false only while rolling out that migration.
var ImageJobWorkerEnabled = parseEnvBool("IMAGE_JOB_WORKER_ENABLED", true)
var ProviderAPIKeyMasterKey = FirstNonEmpty(
	os.Getenv("PROVIDER_API_KEY_MASTER_KEY"),
	os.Getenv("API_KEY_MASTER_KEY"),
	os.Getenv("API_KEY_ENCRYPTION_KEY"),
)

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

func loadEnvFiles() bool {
	if isTestBinary() && strings.ToLower(os.Getenv("GO_GATEWAY_LOAD_ENV_IN_TESTS")) != "true" {
		return false
	}
	cwd, err := os.Getwd()
	if err != nil {
		cwd = "."
	}
	return loadEnvFilesFrom(cwd)
}

func loadEnvFilesFrom(cwd string) bool {
	loaded := false
	for _, path := range envCandidatePaths(cwd) {
		if err := godotenv.Load(path); err == nil {
			loaded = true
		}
	}
	return loaded
}

func envCandidatePaths(cwd string) []string {
	candidates := []string{filepath.Join(cwd, ".env")}
	if repoRoot := findRepoRoot(cwd); repoRoot != "" {
		candidates = append(candidates,
			filepath.Join(repoRoot, "backend", "go-gateway", ".env"),
			filepath.Join(repoRoot, "backend", "gateway", ".env"),
			filepath.Join(repoRoot, ".env"),
		)
	}
	return uniqueCleanPaths(candidates)
}

func findRepoRoot(start string) string {
	dir, err := filepath.Abs(start)
	if err != nil {
		return ""
	}
	for {
		if pathExists(filepath.Join(dir, "package.json")) && pathExists(filepath.Join(dir, "backend", "gateway")) {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func uniqueCleanPaths(paths []string) []string {
	seen := make(map[string]struct{}, len(paths))
	unique := make([]string, 0, len(paths))
	for _, path := range paths {
		cleaned := filepath.Clean(path)
		if _, ok := seen[cleaned]; ok {
			continue
		}
		seen[cleaned] = struct{}{}
		unique = append(unique, cleaned)
	}
	return unique
}

func isTestBinary() bool {
	name := filepath.Base(os.Args[0])
	return strings.HasSuffix(name, ".test") || strings.HasSuffix(name, ".test.exe")
}

func supabasePublishableKeyFromEnv() string {
	return FirstNonEmpty(
		os.Getenv("SUPABASE_PUBLISHABLE_KEY"),
		os.Getenv("UPABASE_PUBLISHABLE_KEY"),
		os.Getenv("SUPABASE_ANON_KEY"),
		os.Getenv("VITE_SUPABASE_PUBLISHABLE_KEY"),
		os.Getenv("VITE_SUPABASE_ANON_KEY"),
	)
}

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
