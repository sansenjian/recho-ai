package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	"go-gateway/internal/middleware"
	"go-gateway/internal/pkg/response"
	"go-gateway/internal/service"

	"github.com/go-chi/chi/v5"
)

type ChatHandler struct {
	chatService *service.ChatService
	creditSvc   *service.CreditService
	analysisURL string
}

func NewChatHandler(chatSvc *service.ChatService, creditSvc *service.CreditService, analysisURL string) *ChatHandler {
	return &ChatHandler{
		chatService: chatSvc,
		creditSvc:   creditSvc,
		analysisURL: analysisURL,
	}
}

type ChatRequest struct {
	Model    string    `json:"model"`
	Messages []Message `json:"messages"`
	Stream   *bool     `json:"stream"`
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatResponse struct {
	ID      string   `json:"id"`
	Object  string   `json:"object"`
	Created int64    `json:"created"`
	Model   string   `json:"model"`
	Choices []Choice `json:"choices"`
	Usage   *Usage   `json:"usage,omitempty"`
}

type Choice struct {
	Index        int     `json:"index"`
	Message      Message `json:"message"`
	FinishReason string  `json:"finish_reason"`
}

type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// ChatStreamResponse SSE 流式响应
type ChatStreamResponse struct {
	ID      string         `json:"id"`
	Object  string         `json:"object"`
	Created int64          `json:"created"`
	Model   string         `json:"model"`
	Choices []StreamChoice `json:"choices"`
}

type StreamChoice struct {
	Index        int                    `json:"index"`
	Delta        map[string]interface{} `json:"delta"`
	FinishReason string                 `json:"finish_reason,omitempty"`
}

// StreamChunk for SSE
type StreamChunk struct {
	Event string      `json:"event,omitempty"`
	Data  interface{} `json:"data"`
}

func (h *ChatHandler) Chat(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromRequest(r)
	if user == nil {
		response.Error(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	var req ChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Default stream to true if not specified
	stream := true
	if req.Stream != nil {
		stream = *req.Stream
	}

	// Build messages for upstream
	messages := make([]map[string]string, len(req.Messages))
	for i, m := range req.Messages {
		messages[i] = map[string]string{
			"role":    m.Role,
			"content": m.Content,
		}
	}

	// Prepare upstream request
	upstreamReq := map[string]interface{}{
		"model":    req.Model,
		"messages": messages,
		"stream":   stream,
	}

	body, err := json.Marshal(upstreamReq)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "Failed to build request")
		return
	}

	// Call chat service
	if stream {
		h.handleStream(r.Context(), w, user.ID, req.Model, body)
	} else {
		h.handleNonStream(r.Context(), w, user.ID, req.Model, body)
	}
}

func (h *ChatHandler) handleNonStream(ctx context.Context, w http.ResponseWriter, userID, model string, body []byte) {
	resp, err := h.chatService.Chat(ctx, model, body)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, fmt.Sprintf("Chat service error: %v", err))
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func (h *ChatHandler) handleStream(ctx context.Context, w http.ResponseWriter, userID, model string, body []byte) {
	// Reserve credits before streaming (model-specific cost)
	creditCost := float64(h.chatService.GetCreditCost(model))
	var txID string
	if h.creditSvc != nil {
		id, _, err := h.creditSvc.ReserveAmount(ctx, userID, creditCost, map[string]any{
			"source": "chat",
			"model":  model,
		})
		if err != nil {
			balance, _ := h.creditSvc.GetBalance(ctx, userID)
			if balance < creditCost {
				response.Error(w, http.StatusPaymentRequired, fmt.Sprintf("Insufficient credits. Required: %.2f, Available: %.2f", creditCost, balance))
				return
			}
			response.Error(w, http.StatusServiceUnavailable, "Credit service unavailable")
			return
		} else {
			txID = id
		}
	}

	// Call upstream chat API with streaming
	resp, err := h.chatService.Chat(ctx, model, body)
	if err != nil {
		// Refund on error (using the original transaction ID for linked refund)
		if h.creditSvc != nil && txID != "" {
			h.creditSvc.RefundCredits(ctx, userID, txID, creditCost, "chat_error")
		}
		response.Error(w, http.StatusInternalServerError, fmt.Sprintf("Chat service error: %v", err))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		respBody, _ := io.ReadAll(resp.Body)
		if h.creditSvc != nil && txID != "" {
			if _, refundErr := h.creditSvc.RefundCredits(ctx, userID, txID, creditCost, "chat_upstream_error"); refundErr != nil {
				log.Printf("[chat] failed to refund credits after upstream status %d: %v", resp.StatusCode, refundErr)
			}
		}
		response.Error(w, resp.StatusCode, fmt.Sprintf("Chat upstream error: %s", string(respBody)))
		return
	}

	// Create SSE writer
	flusher, ok := w.(http.Flusher)
	if !ok {
		response.Error(w, http.StatusInternalServerError, "SSE not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Stream response to client
	reader := resp.Body

	buffer := &bytes.Buffer{}

	for {
		select {
		case <-ctx.Done():
			return
		default:
			buf := make([]byte, 1024)
			n, err := reader.Read(buf)
			if n > 0 {
				buffer.Write(buf[:n])

				// Parse and forward SSE data
				lines := bytes.Split(buffer.Bytes(), []byte("\n"))
				for i := 0; i < len(lines)-1; i++ {
					line := lines[i]
					if len(line) > 0 && bytes.HasPrefix(line, []byte("data: ")) {
						data := line[6:]
						if string(data) == "[DONE]" {
							fmt.Fprintf(w, "data: [DONE]\n\n")
							flusher.Flush()
						} else {
							// Forward the chunk as-is
							fmt.Fprintf(w, "data: %s\n\n", data)
							flusher.Flush()
						}
					}
				}
				buffer.Reset()
				if len(lines) > 0 {
					buffer.Write(lines[len(lines)-1])
				}

				flusher.Flush()
			}
			if err == io.EOF {
				return
			}
			if err != nil {
				log.Printf("[chat] stream read failed: %v", err)
				if h.creditSvc != nil && txID != "" {
					if _, refundErr := h.creditSvc.RefundCredits(ctx, userID, txID, creditCost, "chat_stream_error"); refundErr != nil {
						log.Printf("[chat] failed to refund credits after stream error: %v", refundErr)
					}
				}
				fmt.Fprintf(w, "event: error\ndata: %q\n\n", err.Error())
				fmt.Fprint(w, "data: [DONE]\n\n")
				flusher.Flush()
				return
			}
		}
	}
}

// ChatHistory handles GET /api/chat/history
func (h *ChatHandler) ChatHistory(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromRequest(r)
	if user == nil {
		response.Error(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	history, err := h.chatService.GetChatHistory(user.ID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "Failed to get chat history")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(history)
}

// Routes registers chat routes
func (h *ChatHandler) Routes() http.Handler {
	r := chi.NewRouter()
	r.Post("/", h.Chat)
	r.Get("/history", h.ChatHistory)
	return r
}
