// Package orchestrator 承载图片生成管线的业务编排逻辑。
//
// 设计原则：
//   - 资源服务（credit / storage / imagegen / idempotency）只做单步原子操作，
//     通过接口注入，彼此不知道对方存在。
//   - ImageOrchestrator 只组合资源，不实现资源细节。
//   - 异步持久化用 saga 显式建模，补偿动作集中管理，避免散落回滚点。
//
// 该包不导入 net/http 之外的 HTTP 概念；HTTP 状态码通过 StatusError 返回，
// 由 handler 层负责真正的 HTTP 响应写入。
package orchestrator

import (
	"context"

	"go-gateway/internal/service"
)

// --- 资源接口（从 handler 包迁移，签名保持不变以兼容现有 stub） ---

// CreditService 描述额度资源操作。预留/退款走 PostgreSQL RPC，保证原子性。
type CreditService interface {
	ReserveCredits(ctx context.Context, userID string, imageCount int) (transactionID string, newBalance float64, creditCostPerImage float64, totalCost float64, err error)
	RefundCredits(ctx context.Context, userID string, transactionID string, refundAmount float64, reason string) (float64, error)
	GetCreditCost(ctx context.Context, imageCount int) (costPerImage, totalCost float64)
}

// StorageService 描述图片存储与历史资源操作。
type StorageService interface {
	StoreFromURL(ctx context.Context, url, pathHint string) (*service.StoredImage, error)
	StoreFromBuffer(ctx context.Context, data []byte, mime, hint string) (*service.StoredImage, error)
	StoreFromBufferAtPath(ctx context.Context, data []byte, mime, storagePath string) (*service.StoredImage, error)
	DownloadImage(ctx context.Context, storagePath string) (*service.DownloadedImage, error)
	SaveImageHistory(ctx context.Context, item *service.ImageHistoryItem, userID string) error
	ListImageHistory(ctx context.Context, userID, scope string, limit, offset int) (*service.ImageHistory, error)
	GetImageHistory(ctx context.Context, id, userID, scope string) (*service.ImageHistoryItem, error)
	GetImageVisibilityByPath(ctx context.Context, storagePath string) (visibility string, ownerID string, err error)
	DeleteImageHistory(ctx context.Context, id, userID string) (bool, error)
	ClearImageHistory(ctx context.Context, userID string) (int64, error)
	CleanupObjects(paths ...string)
}

// IdempotencyService 描述幂等控制资源操作。
type IdempotencyService interface {
	Acquire(ctx context.Context, userID, idemKey, scope string, body []byte) (*service.IdempotencyOutcome, error)
	Fail(ctx context.Context, userID, idemKey, scope string) error
	Complete(ctx context.Context, userID, idemKey, scope string, responseCode int16, responseBody any, transactionID string) error
}

// ProviderSettingsService 描述图片 Provider 配置读取。
type ProviderSettingsService interface {
	ImageProvider(ctx context.Context) (service.ImageProviderConfig, error)
}

// --- Domain 类型（handler 包通过类型别名 re-export，保持测试不变） ---

// GenRequest 是图片生成请求的 domain 表示，与 HTTP body 一一对应。
type GenRequest struct {
	Prompt        string         `json:"prompt"`
	DisplayPrompt string         `json:"displayPrompt,omitempty"`
	UserPrompt    string         `json:"userPrompt,omitempty"`
	SystemPrompt  string         `json:"systemPrompt,omitempty"`
	ModelPrompt   string         `json:"modelPrompt,omitempty"`
	Size          string         `json:"size,omitempty"`
	AspectRatio   string         `json:"aspectRatio,omitempty"`
	Resolution    string         `json:"resolution,omitempty"`
	Quality       string         `json:"quality,omitempty"`
	Count         int            `json:"count,omitempty"`
	References    []GenReference `json:"references,omitempty"`
}

// GenReference 表示一张参考图。
type GenReference struct {
	ID            string `json:"id,omitempty"`
	Title         string `json:"title,omitempty"`
	DataUrl       string `json:"dataUrl,omitempty"`
	StoragePath   string `json:"storagePath,omitempty"`
	PreviewURL    string `json:"previewUrl,omitempty"`
	PreviewPath   string `json:"previewPath,omitempty"`
	ThumbnailURL  string `json:"thumbnailUrl,omitempty"`
	ThumbnailPath string `json:"thumbnailPath,omitempty"`
	Content       string `json:"content,omitempty"`
	FileName      string `json:"fileName,omitempty"`
}

// GenResponse 是图片生成响应的 domain 表示，直接作为 HTTP response body。
type GenResponse struct {
	Images        []ImageResult `json:"images"`
	CreditCost    float64       `json:"creditCost,omitempty"`
	TotalCost     float64       `json:"totalCost,omitempty"`
	CreditBalance *struct {
		Balance float64 `json:"balance"`
	} `json:"creditBalance,omitempty"`
}

// ImageResult 表示一张生成结果。
type ImageResult struct {
	ID                string                          `json:"id"`
	UserID            string                          `json:"userId,omitempty"`
	GenerationBatchID string                          `json:"generationBatchId,omitempty"`
	StoragePath       string                          `json:"storagePath,omitempty"`
	URL               string                          `json:"url,omitempty"`
	TemporaryURL      string                          `json:"temporaryUrl,omitempty"`
	PersistenceStatus string                          `json:"persistenceStatus,omitempty"`
	DataURL           string                          `json:"dataUrl,omitempty"`
	PreviewURL        string                          `json:"previewUrl,omitempty"`
	PreviewPath       string                          `json:"previewPath,omitempty"`
	ThumbnailURL      string                          `json:"thumbnailUrl,omitempty"`
	ThumbnailPath     string                          `json:"thumbnailPath,omitempty"`
	Prompt            string                          `json:"prompt"`
	UserPrompt        string                          `json:"userPrompt,omitempty"`
	SystemPrompt      string                          `json:"systemPrompt,omitempty"`
	ModelPrompt       string                          `json:"modelPrompt,omitempty"`
	References        []service.ImageHistoryReference `json:"references,omitempty"`
	ReferenceCount    int                             `json:"referenceImageCount,omitempty"`
	Bytes             int                             `json:"bytes,omitempty"`
	Visibility        string                          `json:"visibility,omitempty"`
	FundingSource     string                          `json:"fundingSource,omitempty"`
	CreditCost        float64                         `json:"creditCost,omitempty"`
	RevisedPrompt     string                          `json:"revisedPrompt,omitempty"`
	Size              string                          `json:"size"`
	AspectRatio       string                          `json:"aspectRatio,omitempty"`
	Resolution        string          `json:"resolution,omitempty"`
	Quality           string          `json:"quality,omitempty"`
	Timestamp         string          `json:"timestamp"`
	Width             int             `json:"width,omitempty"`
	Height            int             `json:"height,omitempty"`
}

// --- 错误类型 ---

// StatusError 携带一个 HTTP 状态码与面向用户的消息。
// orchestrator 返回此错误时，handler 直接使用其 Code/Message 写响应，
// 不再二次推断业务条件。Headers 可选（如幂等重放需要 X-Idempotent-Replay）。
type StatusError struct {
	Code    int
	Message string
	// Headers 是需要写入 HTTP 响应的额外头（如 X-Idempotent-Replay）。
	// 为 nil 表示无额外头。
	Headers map[string]string
	// Body 用于幂等重放场景：直接写回缓存的原始字节，跳过 JSON 序列化。
	// 为 nil 表示走 Message 的 JSON 序列化路径。
	Body []byte
}

func (e *StatusError) Error() string { return e.Message }

// --- 内部辅助类型 ---

// generatedImageRecord 是 provider 返回结果 + 原始数据源（用于持久化）。
type generatedImageRecord struct {
	result ImageResult
	source imageSource
}

type imageSource struct {
	URL    string
	Base64 string
	Mime   string
}

type imageGenerationMetadata struct {
	BatchID             string
	UserID              string
	DisplayPrompt       string
	SystemPrompt        string
	ModelPrompt         string
	Size                string
	AspectRatio         string
	Resolution          string
	Quality             string
	ImageModel          string
	References          []service.ImageHistoryReference
	ReferenceCount      int
	Visibility          string
	FundingSource       string
	CreditCost          float64
	CreditTransactionID string
}
