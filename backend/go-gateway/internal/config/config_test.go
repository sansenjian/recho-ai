package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEnvCandidatePathsIncludesNodeGatewayEnv(t *testing.T) {
	repoRoot := t.TempDir()
	goGateway := filepath.Join(repoRoot, "backend", "go-gateway")
	nodeGateway := filepath.Join(repoRoot, "backend", "gateway")
	if err := os.MkdirAll(goGateway, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(nodeGateway, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repoRoot, "package.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}

	paths := envCandidatePaths(goGateway)
	want := filepath.Join(repoRoot, "backend", "gateway", ".env")

	for _, got := range paths {
		if got == want {
			return
		}
	}
	t.Fatalf("expected env candidates to include %q, got %#v", want, paths)
}

func TestSupabasePublishableKeyAllowsLegacyTypoFallback(t *testing.T) {
	t.Setenv("SUPABASE_PUBLISHABLE_KEY", "")
	t.Setenv("UPABASE_PUBLISHABLE_KEY", " legacy-key ")
	t.Setenv("SUPABASE_ANON_KEY", "")
	t.Setenv("VITE_SUPABASE_PUBLISHABLE_KEY", "")
	t.Setenv("VITE_SUPABASE_ANON_KEY", "")

	got := supabasePublishableKeyFromEnv()
	if got != "legacy-key" {
		t.Fatalf("expected legacy typo fallback key, got %q", got)
	}
}
