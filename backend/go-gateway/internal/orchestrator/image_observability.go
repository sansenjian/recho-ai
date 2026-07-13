package orchestrator

import (
	"encoding/json"
	"net/url"
	"strings"
)

type imageLifecycleEvent struct {
	Event               string `json:"-"`
	RequestID           string `json:"request_id,omitempty"`
	GenerationID        string `json:"generation_id,omitempty"`
	CreditTransactionID string `json:"credit_transaction_id,omitempty"`
	Provider            string `json:"provider,omitempty"`
	ErrorCode           string `json:"error_code,omitempty"`
	RequestedCount      int    `json:"requested_count"`
	ReturnedCount       int    `json:"returned_count"`
}

func imageLifecycleLog(event imageLifecycleEvent) string {
	payload := map[string]any{
		"event": "image." + strings.TrimPrefix(event.Event, "image."),
	}
	data, _ := json.Marshal(event)
	var fields map[string]any
	if json.Unmarshal(data, &fields) == nil {
		for key, value := range fields {
			payload[key] = value
		}
	}
	encoded, _ := json.Marshal(payload)
	return string(encoded)
}

func imageProviderName(baseURL string) string {
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Hostname() == "" {
		return "unknown"
	}
	return parsed.Hostname()
}

func (o *ImageOrchestrator) logImageLifecycle(event imageLifecycleEvent) {
	if o != nil && o.logger != nil {
		o.logger.Print(imageLifecycleLog(event))
	}
}
