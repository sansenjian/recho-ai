package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/go-chi/chi/v5"
	"go-gateway/internal/middleware"
)

type contractRoute struct {
	ID     string `json:"id"`
	Method string `json:"method"`
	Path   string `json:"path"`
}

type contractScenario struct {
	ID               string            `json:"id"`
	Method           string            `json:"method"`
	Path             string            `json:"path"`
	ExpectedStatus   int               `json:"expectedStatus"`
	RequiredJSONKeys []string          `json:"requiredJsonKeys"`
	ExpectedCode     string            `json:"expectedCode"`
	RequestJSON      map[string]any    `json:"requestJson"`
	Headers          map[string]string `json:"headers"`
}

type goOwnedContract struct {
	Version       int                `json:"version"`
	Routes        []contractRoute    `json:"routes"`
	LiveScenarios []contractScenario `json:"liveScenarios"`
}

func TestContractRoutesAreRegistered(t *testing.T) {
	contract := loadGoOwnedContractForTest(t)
	routes := collectContractRoutes(t, newContractRouter())

	for _, route := range contract.Routes {
		key := route.Method + " " + route.Path
		if !routes[key] {
			t.Errorf("contracted route is not registered: %s", key)
		}
	}
}

func TestContractLiveScenariosMatchHandlers(t *testing.T) {
	contract := loadGoOwnedContractForTest(t)
	router := newContractRouter()

	for _, scenario := range contract.LiveScenarios {
		t.Run(scenario.ID, func(t *testing.T) {
			assertContractScenario(t, router, scenario)
		})
	}
}

func loadGoOwnedContractForTest(t *testing.T) goOwnedContract {
	t.Helper()
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve contract test path")
	}
	contractPath := filepath.Clean(filepath.Join(filepath.Dir(currentFile), "..", "..", "..", "..", "contracts", "go-owned-api.json"))
	contents, err := os.ReadFile(contractPath)
	if err != nil {
		t.Fatalf("read shared contract: %v", err)
	}
	var contract goOwnedContract
	if err := json.Unmarshal(contents, &contract); err != nil {
		t.Fatalf("decode shared contract: %v", err)
	}
	if contract.Version != 1 || len(contract.Routes) == 0 || len(contract.LiveScenarios) == 0 {
		t.Fatalf("invalid shared contract: version=%d routes=%d scenarios=%d", contract.Version, len(contract.Routes), len(contract.LiveScenarios))
	}
	return contract
}

func newContractRouter() *chi.Mux {
	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Route("/api", func(r chi.Router) {
		NewConfigHandler(nil, nil).RegisterRoutes(r)
		NewCreditsHandler(nil, nil, nil).RegisterRoutes(r)
		r.Route("/image", func(r chi.Router) {
			NewImageHandler(nil, nil, nil).RegisterRoutes(r)
		})
	})
	return router
}

func collectContractRoutes(t *testing.T, router chi.Routes) map[string]bool {
	t.Helper()
	routes := make(map[string]bool)
	if err := chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		routes[method+" "+route] = true
		return nil
	}); err != nil {
		t.Fatalf("walk chi routes: %v", err)
	}
	return routes
}

func assertContractScenario(t *testing.T, router http.Handler, scenario contractScenario) {
	t.Helper()
	requestID := "req_go_contract-" + scenario.ID
	var requestBody *bytes.Reader
	if scenario.RequestJSON != nil {
		encoded, err := json.Marshal(scenario.RequestJSON)
		if err != nil {
			t.Fatalf("encode request JSON: %v", err)
		}
		requestBody = bytes.NewReader(encoded)
	} else {
		requestBody = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(scenario.Method, scenario.Path, requestBody)
	req.Header.Set("X-Request-ID", requestID)
	for key, value := range scenario.Headers {
		req.Header.Set(key, value)
	}
	if scenario.RequestJSON != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != scenario.ExpectedStatus {
		t.Fatalf("expected status %d, got %d body=%s", scenario.ExpectedStatus, rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("X-Request-ID"); got != requestID {
		t.Fatalf("expected request ID %q, got %q", requestID, got)
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode scenario response: %v", err)
	}
	for _, key := range scenario.RequiredJSONKeys {
		if _, ok := body[key]; !ok {
			t.Errorf("response is missing required key %q: %#v", key, body)
		}
	}
	if scenario.ExpectedCode != "" && body["code"] != scenario.ExpectedCode {
		t.Errorf("expected code %q, got %#v", scenario.ExpectedCode, body["code"])
	}
}
