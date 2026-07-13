package orchestrator

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestImageLifecycleLogUsesSafeCorrelationFields(t *testing.T) {
	line := imageLifecycleLog(imageLifecycleEvent{
		Event: "provider_failed", RequestID: "request-1", GenerationID: "batch-1",
		CreditTransactionID: "tx-1", Provider: "provider.example", ErrorCode: ErrorCodeProviderBadResponse,
		RequestedCount: 2, ReturnedCount: 1,
	})
	var decoded map[string]any
	if err := json.Unmarshal([]byte(line), &decoded); err != nil {
		t.Fatalf("decode lifecycle log: %v", err)
	}
	if decoded["event"] != "image.provider_failed" || decoded["request_id"] != "request-1" || decoded["generation_id"] != "batch-1" {
		t.Fatalf("unexpected lifecycle log: %#v", decoded)
	}
	if strings.Contains(line, "prompt") || strings.Contains(line, "base64") || strings.Contains(line, "api_key") {
		t.Fatalf("lifecycle log contains unsafe fields: %s", line)
	}
}

func TestImageLifecycleLogPreservesZeroCounts(t *testing.T) {
	line := imageLifecycleLog(imageLifecycleEvent{Event: "provider_failed"})
	var decoded map[string]any
	if err := json.Unmarshal([]byte(line), &decoded); err != nil {
		t.Fatalf("decode lifecycle log: %v", err)
	}
	if decoded["requested_count"] != float64(0) || decoded["returned_count"] != float64(0) {
		t.Fatalf("zero image counts missing from lifecycle log: %#v", decoded)
	}
}
