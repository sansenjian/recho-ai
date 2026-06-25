package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type ChatService struct {
	chatURL       string
	chatAPIKey    string
	analysisURL   string
	httpClient    *http.Client
	creditConfigs map[string]int // model -> credits per request
}

func NewChatService(chatURL, chatAPIKey, analysisURL string) *ChatService {
	return &ChatService{
		chatURL:     chatURL,
		chatAPIKey:  chatAPIKey,
		analysisURL: analysisURL,
		httpClient: &http.Client{
			Timeout: 120 * time.Second,
		},
		creditConfigs: map[string]int{
			"gpt-4":           100,
			"gpt-4-turbo":     100,
			"gpt-3.5-turbo":   10,
			"claude-3-opus":   100,
			"claude-3-sonnet": 50,
			"claude-3-haiku":  10,
			"default":         10,
		},
	}
}

func (s *ChatService) Chat(ctx context.Context, model string, body []byte) (*http.Response, error) {
	url := s.chatURL
	if url == "" {
		return nil, fmt.Errorf("chat upstream is not configured")
	}
	if !strings.HasSuffix(url, "/chat/completions") {
		url = strings.TrimRight(url, "/") + "/v1/chat/completions"
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if s.chatAPIKey != "" {
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", s.chatAPIKey))
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}

	return resp, nil
}

func (s *ChatService) GetCreditCost(model string) int {
	if cost, ok := s.creditConfigs[model]; ok {
		return cost
	}
	return s.creditConfigs["default"]
}

// ChatHistoryItem represents a single chat message in history
type ChatHistoryItem struct {
	ID        string    `json:"id"`
	Model     string    `json:"model"`
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}

// GetChatHistory retrieves chat history for a user
func (s *ChatService) GetChatHistory(userID string) ([]ChatHistoryItem, error) {
	// TODO: Implement database query for chat history
	// For now, return empty slice
	return []ChatHistoryItem{}, nil
}

// SaveChatMessage saves a chat message to history
func (s *ChatService) SaveChatMessage(userID, model, role, content string) error {
	// TODO: Implement database insert for chat history
	return nil
}

// SendAnalytics sends usage analytics. The provided ctx should be derived from
// the request context so the analytics call is cancelled when the client
// disconnects, instead of using a detached context.Background().
func (s *ChatService) SendAnalytics(ctx context.Context, userID, event string, data map[string]interface{}) error {
	if s.analysisURL == "" {
		return nil
	}

	payload := map[string]interface{}{
		"user_id": userID,
		"event":   event,
		"data":    data,
		"ts":      time.Now().Unix(),
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", s.analysisURL+"/api/analytics", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respBody, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return readErr
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("analytics request failed with status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}
