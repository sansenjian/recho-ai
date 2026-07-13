// Package orchestrator 承载图片生成管线的业务编排逻辑。
//
// 设计原则：
//   - 资源服务（credit / storage / imagegen / idempotency）只做单步原子操作，
//     通过接口注入，彼此不知道对方存在。
//   - ImageOrchestrator 只组合资源，不实现资源细节。
//   - durable staging job 与兼容 saga 都通过显式补偿边界建模，避免散落回滚点。
//
// 该包不导入 net/http 之外的 HTTP 概念；HTTP 状态码通过 StatusError 返回，
// 由 handler 层负责真正的 HTTP 响应写入。
package orchestrator

import (
	"context"
	"encoding/json"
	"time"

	"go-gateway/internal/repository"
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
	StageFromURL(ctx context.Context, sourceURL, storagePath string) (*service.StagedImage, error)
	StageFromBuffer(ctx context.Context, data []byte, mime, storagePath string) (*service.StagedImage, error)
	DeleteObjects(ctx context.Context, paths ...string) error
	DeleteImageHistoryByID(ctx context.Context, id string) error
	DownloadImage(ctx context.Context, storagePath string) (*service.DownloadedImage, error)
	SaveImageHistory(ctx context.Context, item *service.ImageHistoryItem, userID string) error
	ListImageHistory(ctx context.Context, userID, scope string, limit, offset int) (*service.ImageHistory, error)
	GetImageHistory(ctx context.Context, id, userID, scope string) (*service.ImageHistoryItem, error)
	GetImageVisibilityByPath(ctx context.Context, storagePath string) (visibility string, ownerID string, err error)
	DeleteImageHistory(ctx context.Context, id, userID string) (bool, error)
	ClearImageHistory(ctx context.Context, userID string) (int64, error)
	CleanupObjects(paths ...string)
}

// ImageJobEnqueuer is the request-path subset of the durable image job
// repository. The worker owns processing and completion after activation.
type ImageJobEnqueuer interface {
	CreateStaging(ctx context.Context, input repository.CreateImageGenerationJob) (*repository.ImageGenerationJob, error)
	SaveStagingManifest(ctx context.Context, jobID, ownerID, leaseToken string, manifest json.RawMessage, lease time.Duration) error
	Activate(ctx context.Context, jobID, ownerID, leaseToken string) error
	QueueCompensation(ctx context.Context, jobID, ownerID, leaseToken string, manifest json.RawMessage, code, detail string) error
}

// ImageJobCreditStarter atomically binds the existing idempotency claim,
// credit reservation, and initial staging job before the provider is called.
type ImageJobCreditStarter interface {
	StartWithCredit(ctx context.Context, input repository.StartImageGenerationJobInput) (*repository.ImageGenerationJobStart, error)
}

// ImageJobStagingRefundRecorder records a partial provider refund while the
// request still owns the staging lease.
type ImageJobStagingRefundRecorder interface {
	RecordStagingRefund(ctx context.Context, jobID, ownerID, leaseToken string, amount float64, returnedCount int, lease time.Duration) error
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
	Resolution        string                          `json:"resolution,omitempty"`
	Quality           string                          `json:"quality,omitempty"`
	Timestamp         string                          `json:"timestamp"`
	Width             int                             `json:"width,omitempty"`
	Height            int                             `json:"height,omitempty"`
}

// --- 错误类型 ---

// StatusError 携带一个 HTTP 状态码与面向用户的消息。
// orchestrator 返回此错误时，handler 直接使用其 Code/Message 写响应，
// 不再二次推断业务条件。Headers 可选（如幂等重放需要 X-Idempotent-Replay）。
type StatusError struct {
	Code      int
	ErrorCode string
	Message   string
	// Headers 是需要写入 HTTP 响应的额外头（如 X-Idempotent-Replay）。
	// 为 nil 表示无额外头。
	Headers map[string]string
	// Body 用于幂等重放场景：直接写回缓存的原始字节，跳过 JSON 序列化。
	// 为 nil 表示走 Message 的 JSON 序列化路径。
	Body []byte
}

func (e *StatusError) Error() string { return e.Message }

const (
	ErrorCodeIdempotencyKeyRequired = "IDEMPOTENCY_KEY_REQUIRED"
	ErrorCodeIdempotencyConflict    = "IDEMPOTENCY_CONFLICT"
	ErrorCodeIdempotencyUnavailable = "IDEMPOTENCY_UNAVAILABLE"
	ErrorCodeInsufficientCredits    = "INSUFFICIENT_CREDITS"
	ErrorCodeCreditUnavailable      = "CREDIT_SERVICE_UNAVAILABLE"
	ErrorCodeProviderUnavailable    = "PROVIDER_UNAVAILABLE"
	ErrorCodeProviderBadResponse    = "PROVIDER_BAD_RESPONSE"
	ErrorCodeStorageUnavailable     = "STORAGE_UNAVAILABLE"
	ErrorCodeImageJobUnavailable    = "IMAGE_JOB_UNAVAILABLE"
	ErrorCodePersistenceQueueFailed = "PERSISTENCE_QUEUE_FAILED"
)

func domainStatusError(status int, code, message string) *StatusError {
	return &StatusError{Code: status, ErrorCode: code, Message: message}
}

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
	TotalCost           float64
	CreditBalance       *float64
}

// imageJobManifest is the durable hand-off payload between the request path
// and the persistence worker. Provider source URLs/base64 are deliberately
// kept out of this JSON and remain request-local until staged.
type imageJobManifest struct {
	Version  int                     `json:"version"`
	Metadata imageJobMetadata        `json:"metadata"`
	Images   []imageJobManifestImage `json:"images"`
}

type imageJobMetadata struct {
	BatchID             string                          `json:"batchId"`
	UserID              string                          `json:"userId,omitempty"`
	DisplayPrompt       string                          `json:"displayPrompt,omitempty"`
	SystemPrompt        string                          `json:"systemPrompt,omitempty"`
	ModelPrompt         string                          `json:"modelPrompt,omitempty"`
	Size                string                          `json:"size,omitempty"`
	AspectRatio         string                          `json:"aspectRatio,omitempty"`
	Resolution          string                          `json:"resolution,omitempty"`
	Quality             string                          `json:"quality,omitempty"`
	ImageModel          string                          `json:"imageModel,omitempty"`
	References          []service.ImageHistoryReference `json:"references,omitempty"`
	ReferenceCount      int                             `json:"referenceCount,omitempty"`
	Visibility          string                          `json:"visibility,omitempty"`
	FundingSource       string                          `json:"fundingSource,omitempty"`
	CreditCost          float64                         `json:"creditCost,omitempty"`
	CreditTransactionID string                          `json:"creditTransactionId,omitempty"`
	TotalCost           float64                         `json:"totalCost,omitempty"`
	CreditBalance       *float64                        `json:"creditBalance,omitempty"`
}

type imageJobManifestImage struct {
	Result       ImageResult `json:"result"`
	StagedPath   string      `json:"stagedPath,omitempty"`
	StagedMime   string      `json:"stagedMime,omitempty"`
	StagedBytes  int         `json:"stagedBytes,omitempty"`
	StagedSHA256 string      `json:"stagedSha256,omitempty"`
	Phase        string      `json:"phase"`
}
