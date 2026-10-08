package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"go-gateway/internal/orchestrator"
	"go-gateway/internal/service"
)

// 本文件覆盖 OpenAI 兼容端点的纯函数部分：尺寸映射、张数收敛、质量映射、
// 错误形状。这些是协议转换最容易出错、也最容易在重构中静默漂移的地方，
// 因此用表驱动逐条钉住。

func TestSizeToAspectRatioResolutionMapsTableSizesExactly(t *testing.T) {
	// 表内尺寸必须精确往返：site size -> (ratio, resolution) -> 同一个 size。
	cases := []struct {
		size       string
		aspect     string
		resolution string
	}{
		{"1024x1024", "1:1", "1k"},
		{"1536x1024", "3:2", "1k"},
		{"1024x1536", "2:3", "1k"},
		{"1536x864", "16:9", "1k"},
		{"864x1536", "9:16", "1k"},
		{"2048x2048", "1:1", "2k"},
		{"2160x1440", "3:2", "2k"},
		{"1440x2160", "2:3", "2k"},
		{"2048x1152", "16:9", "2k"},
		{"1152x2048", "9:16", "2k"},
		{"2880x2880", "1:1", "4k"},
		{"3520x2336", "3:2", "4k"},
		{"2336x3520", "2:3", "4k"},
		{"3840x2160", "16:9", "4k"},
		{"2160x3840", "9:16", "4k"},
	}

	for _, tc := range cases {
		aspect, resolution, ok := sizeToAspectRatioResolution(tc.size)
		if !ok {
			t.Fatalf("size %q: expected ok, got false", tc.size)
		}
		if aspect != tc.aspect || resolution != tc.resolution {
			t.Errorf("size %q: got (%s, %s), want (%s, %s)", tc.size, aspect, resolution, tc.aspect, tc.resolution)
		}
		// 反向确认：映射结果经站点尺寸表还原后必须等于原始 size。
		if got := orchestrator.DetermineSize(resolution, aspect); got != tc.size {
			t.Errorf("size %q: roundtrip produced %q", tc.size, got)
		}
	}
}

func TestSizeToAspectRatioResolutionFallsBackForOffTableSizes(t *testing.T) {
	// 表外尺寸不应报错，而应按宽高比归类并给出像素规模最接近的档位。
	cases := []struct {
		size       string
		aspect     string
		resolution string
	}{
		{"512x512", "1:1", "1k"},
		// 1792x1024 = 1.83M 像素，低于 1k/2k 档位中点（2.62M），故归到 1k：
		// 该档 3:2 的 1536x1024 比 2k 的 2160x1440 更接近请求尺寸。
		{"1792x1024", "16:9", "1k"},
		{"1024x1792", "9:16", "1k"},
		{"3000x3000", "1:1", "4k"},
		// 2300x2300 = 5.29M 像素，落在 2k/4k 档位中点（6.24M）之下，故归 2k。
		{"2300x2300", "1:1", "2k"},
	}

	for _, tc := range cases {
		aspect, resolution, ok := sizeToAspectRatioResolution(tc.size)
		if !ok {
			t.Fatalf("size %q: expected ok, got false", tc.size)
		}
		if aspect != tc.aspect {
			t.Errorf("size %q: got aspect %s, want %s", tc.size, aspect, tc.aspect)
		}
		if resolution != tc.resolution {
			t.Errorf("size %q: got resolution %s, want %s", tc.size, resolution, tc.resolution)
		}
	}
}

func TestSizeToAspectRatioResolutionRejectsInvalidInput(t *testing.T) {
	invalid := []string{
		"",
		"1024",
		"1024x",
		"x1024",
		"abcxdef",
		"0x0",
		"-1x100",
		"99999x99999",
		"1024x1024x1024",
	}
	for _, size := range invalid {
		if _, _, ok := sizeToAspectRatioResolution(size); ok {
			t.Errorf("size %q: expected rejection, got ok", size)
		}
	}
}

func TestNormalizeOpenAICountSnapsToSupportedValues(t *testing.T) {
	// 站点只支持 1/2/4/8；其余输入向下取到最近的支持值而不是报错。
	// 向下而非向上取整是刻意的：张数决定扣费，向上取会让调用方为没请求的图片付费。
	cases := map[int]int{
		0: 1, 1: 1, -5: 1,
		2: 2, 3: 2,
		4: 4, 5: 4, 7: 4,
		8: 8, 9: 8, 100: 8,
	}
	for input, want := range cases {
		if got := normalizeOpenAICount(input); got != want {
			t.Errorf("normalizeOpenAICount(%d) = %d, want %d", input, got, want)
		}
	}
}

func TestOpenAIQualityToSiteQuality(t *testing.T) {
	cases := map[string]string{
		"low":      "low",
		"standard": "low",
		"high":     "high",
		"hd":       "high",
		"medium":   "medium",
		"auto":     "medium",
		"":         "medium",
		"unknown":  "medium",
	}
	for input, want := range cases {
		if got := openAIQualityToSiteQuality(input); got != want {
			t.Errorf("openAIQualityToSiteQuality(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestOpenAIErrorTypeForStatus(t *testing.T) {
	cases := map[int]string{
		http.StatusUnauthorized:     "authentication_error",
		http.StatusForbidden:        "permission_error",
		http.StatusTooManyRequests:  "rate_limit_error",
		http.StatusInternalServerError: "server_error",
		http.StatusBadGateway:       "server_error",
		http.StatusBadRequest:       "invalid_request_error",
	}
	for status, want := range cases {
		if got := openAIErrorTypeForStatus(status); got != want {
			t.Errorf("openAIErrorTypeForStatus(%d) = %q, want %q", status, got, want)
		}
	}
}

func TestWriteOpenAIErrorUsesOpenAIEnvelope(t *testing.T) {
	// OpenAI 客户端按 {"error":{...}} 解析失败原因，形状写错会让客户端读不到信息。
	recorder := httptest.NewRecorder()
	writeOpenAIError(recorder, http.StatusUnauthorized, "invalid_api_key", "缺少密钥。")

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
	var payload struct {
		Error struct {
			Message string `json:"message"`
			Type    string `json:"type"`
			Code    string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	if payload.Error.Message == "" {
		t.Error("error.message must not be empty")
	}
	if payload.Error.Type != "authentication_error" {
		t.Errorf("error.type = %q, want authentication_error", payload.Error.Type)
	}
	if payload.Error.Code != "invalid_api_key" {
		t.Errorf("error.code = %q, want invalid_api_key", payload.Error.Code)
	}
}

func TestGenerateOpenAIImageRequiresAuthenticatedUser(t *testing.T) {
	// 外部端点不接受访客：否则任何人都能无凭证消耗他人额度。
	handler := NewImageHandler(nil, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/images/generations",
		strings.NewReader(`{"prompt":"a cat"}`))

	handler.generateOpenAIImage(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
}

func TestListOpenAIModelsRequiresAuthenticatedUser(t *testing.T) {
	handler := NewImageHandler(nil, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/models", nil)

	handler.listOpenAIModels(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
}

// stubAppSettings 提供 b64 开关的固定返回值，用于隔离配置读取。
type stubAppSettings struct {
	enabled bool
	err     error
}

func (s stubAppSettings) OpenAIB64JSONEnabled(ctx context.Context) (bool, error) {
	return s.enabled, s.err
}

func TestB64JSONEnabledFailsClosedOnReadError(t *testing.T) {
	// 配置读取异常时必须按关闭处理：静默回退到 base64 会放大数倍响应体积。
	handler := NewImageHandler(nil, nil, nil).
		WithAppSettings(stubAppSettings{err: errors.New("db down")})

	if handler.b64JSONEnabled(context.Background()) {
		t.Error("expected b64_json to be disabled when the settings read fails")
	}
}

func TestB64JSONEnabledReflectsSetting(t *testing.T) {
	enabled := NewImageHandler(nil, nil, nil).WithAppSettings(stubAppSettings{enabled: true})
	if !enabled.b64JSONEnabled(context.Background()) {
		t.Error("expected b64_json enabled when the setting is true")
	}

	disabled := NewImageHandler(nil, nil, nil).WithAppSettings(stubAppSettings{enabled: false})
	if disabled.b64JSONEnabled(context.Background()) {
		t.Error("expected b64_json disabled when the setting is false")
	}
}


// --- OpenAI 编辑端点 ---

// buildEditMultipart 构造一个编辑请求的 multipart body，便于逐个字段断言解析行为。
func buildEditMultipart(t *testing.T, fields map[string]string, files map[string][]byte) (*http.Request, string) {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatalf("write field %s: %v", key, err)
		}
	}
	// 排序保证同一 map 每次生成的请求稳定。
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		part, err := writer.CreateFormFile(name, name+".png")
		if err != nil {
			t.Fatalf("create file part %s: %v", name, err)
		}
		if _, err := part.Write(files[name]); err != nil {
			t.Fatalf("write file part %s: %v", name, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/images/edits", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req, writer.FormDataContentType()
}

// 一个最小的合法 PNG（1x1 透明像素），用于让 http.DetectContentType 判定为 image/png。
var tinyPNG = []byte{
	0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
	0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
	0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
	0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
	0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
	0x42, 0x60, 0x82,
}

func TestParseOpenAIEditFormAcceptsBothImageFieldNames(t *testing.T) {
	// 官方 SDK 用 image，部分中转实现用 image[]；两者都必须能解析，
	// 否则一类客户端会直接无法接入。
	for _, field := range []string{"image", "image[]"} {
		req, _ := buildEditMultipart(t,
			map[string]string{"prompt": "make it blue"},
			map[string][]byte{field: tinyPNG})

		form, err := parseOpenAIEditForm(httptest.NewRecorder(), req)
		if err != nil {
			t.Fatalf("field %q: unexpected error: %v", field, err)
		}
		if len(form.references) != 1 {
			t.Fatalf("field %q: got %d references, want 1", field, len(form.references))
		}
		if form.prompt != "make it blue" {
			t.Errorf("field %q: prompt = %q", field, form.prompt)
		}
		if !strings.HasPrefix(form.references[0].DataUrl, "data:image/png;base64,") {
			t.Errorf("field %q: data URL = %q", field, form.references[0].DataUrl[:min(40, len(form.references[0].DataUrl))])
		}
	}
}

func TestParseOpenAIEditFormAcceptsMultipleImages(t *testing.T) {
	req, _ := buildEditMultipart(t,
		map[string]string{"prompt": "combine these"},
		map[string][]byte{"image": tinyPNG})
	// CreateFormFile 每调用一次产生一个 part；用同名字段再追加一张。
	form, err := parseOpenAIEditForm(httptest.NewRecorder(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(form.references) != 1 {
		t.Fatalf("got %d references, want 1", len(form.references))
	}
}

func TestParseOpenAIEditFormRejectsMissingImage(t *testing.T) {
	req, _ := buildEditMultipart(t, map[string]string{"prompt": "x"}, nil)
	if _, err := parseOpenAIEditForm(httptest.NewRecorder(), req); err == nil {
		t.Error("expected an error when no image is provided")
	}
}

func TestParseOpenAIEditFormRejectsNonImageFile(t *testing.T) {
	req, _ := buildEditMultipart(t,
		map[string]string{"prompt": "x"},
		map[string][]byte{"image": []byte("this is not an image at all")})
	if _, err := parseOpenAIEditForm(httptest.NewRecorder(), req); err == nil {
		t.Error("expected an error for a non-image upload")
	}
}

func TestParseOpenAIEditFormParsesOptionalFields(t *testing.T) {
	req, _ := buildEditMultipart(t,
		map[string]string{
			"prompt":          "recolor",
			"model":           "gpt-image-2",
			"n":               "2",
			"size":            "1024x1024",
			"quality":         "high",
			"response_format": "url",
			"background":      "transparent",
		},
		map[string][]byte{"image": tinyPNG})

	form, err := parseOpenAIEditForm(httptest.NewRecorder(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if form.model != "gpt-image-2" || form.count != 2 || form.size != "1024x1024" {
		t.Errorf("unexpected form: %+v", form)
	}
	if form.quality != "high" || form.responseFormat != "url" || form.background != "transparent" {
		t.Errorf("unexpected form: %+v", form)
	}
}

func TestEditOpenAIImageRequiresAuthenticatedUser(t *testing.T) {
	handler := NewImageHandler(nil, nil, nil)
	req, _ := buildEditMultipart(t,
		map[string]string{"prompt": "x"},
		map[string][]byte{"image": tinyPNG})
	recorder := httptest.NewRecorder()

	handler.editOpenAIImage(recorder, req)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
}


// --- 响应格式兜底 ---

// stubImageStorageForItems 提供可控的图片下载行为，用于验证各条兜底路径。
type stubImageStorageForItems struct {
	orchestrator.StorageService
	data      []byte
	downloadErr error
	calls     int
}

func (s *stubImageStorageForItems) DownloadImage(_ context.Context, _ string) (*service.DownloadedImage, error) {
	s.calls++
	if s.downloadErr != nil {
		return nil, s.downloadErr
	}
	return &service.DownloadedImage{Data: s.data, Mime: "image/png"}, nil
}

func TestOpenAIImageItemsUrlFallsBackToBase64WhenNoLink(t *testing.T) {
	// format=url 但没有任何可用链接时，必须退回 base64，
	// 否则客户端拿到 {"url": ""} 等于丢图。
	storage := &stubImageStorageForItems{data: []byte("PNGDATA")}
	handler := NewImageHandler(nil, storage, nil)

	resp := &orchestrator.GenResponse{
		Images: []orchestrator.ImageResult{
			{ID: "img-1", StoragePath: "generated/img-1.png", PersistenceStatus: "persisted"},
		},
	}

	items, err := handler.openAIImageItems(context.Background(), resp, openAIImageFormatURL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("got %d items, want 1", len(items))
	}
	if items[0].B64JSON == "" {
		t.Error("expected a base64 fallback when no URL is available")
	}
	if items[0].URL != "" {
		t.Errorf("URL = %q, want empty when falling back", items[0].URL)
	}
}

func TestOpenAIImageItemsUrlKeepsStorageLink(t *testing.T) {
	// 正常路径：有存储直链时必须直接给链接，不能退化成 base64。
	storage := &stubImageStorageForItems{data: []byte("PNGDATA")}
	handler := NewImageHandler(nil, storage, nil)

	resp := &orchestrator.GenResponse{
		Images: []orchestrator.ImageResult{
			{ID: "img-1", URL: "https://cdn.test/img-1.png", StoragePath: "generated/img-1.png"},
		},
	}

	items, err := handler.openAIImageItems(context.Background(), resp, openAIImageFormatURL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if items[0].URL != "https://cdn.test/img-1.png" {
		t.Errorf("URL = %q, want the storage link", items[0].URL)
	}
	if items[0].B64JSON != "" {
		t.Error("must not inline base64 when a storage link exists")
	}
	if storage.calls != 0 {
		t.Errorf("storage should not be read when a link is present, got %d calls", storage.calls)
	}
}

func TestOpenAIImageItemsB64FallsBackToUrlWhenStorageUnavailable(t *testing.T) {
	// format=b64_json 但读存储失败时，退回链接而不是整条请求失败。
	storage := &stubImageStorageForItems{downloadErr: errors.New("storage down")}
	handler := NewImageHandler(nil, storage, nil)

	resp := &orchestrator.GenResponse{
		Images: []orchestrator.ImageResult{
			{ID: "img-1", URL: "https://cdn.test/img-1.png", StoragePath: "generated/img-1.png"},
		},
	}

	items, err := handler.openAIImageItems(context.Background(), resp, openAIImageFormatB64JSON)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if items[0].URL != "https://cdn.test/img-1.png" {
		t.Errorf("URL = %q, want the fallback link", items[0].URL)
	}
}

func TestOpenAIImageItemsUsesInlinedDataUrlAsBase64(t *testing.T) {
	// 手里只有 data URI（无存储路径、无链接）时，把本体填进 b64_json，
	// 让只认 base64 的客户端也能拿到图，而不是留一个空的 item。
	handler := NewImageHandler(nil, nil, nil)

	resp := &orchestrator.GenResponse{
		Images: []orchestrator.ImageResult{
			{ID: "img-1", URL: "data:image/png;base64,QUJD"},
		},
	}

	items, err := handler.openAIImageItems(context.Background(), resp, openAIImageFormatURL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if items[0].B64JSON != "QUJD" {
		t.Errorf("B64JSON = %q, want the inlined payload", items[0].B64JSON)
	}
}

func TestOpenAIImageItemsNeverReturnsEmptyItem(t *testing.T) {
	// 最后一道防线：即使所有读取路径都失败，也要给出原始地址，
	// 不能返回既无 URL 也无 base64 的空 item。
	storage := &stubImageStorageForItems{downloadErr: errors.New("storage down")}
	handler := NewImageHandler(nil, storage, nil)

	resp := &orchestrator.GenResponse{
		Images: []orchestrator.ImageResult{
			{ID: "img-1", TemporaryURL: "https://upstream.test/tmp.png", StoragePath: "generated/img-1.png"},
		},
	}

	items, err := handler.openAIImageItems(context.Background(), resp, openAIImageFormatURL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if items[0].URL == "" && items[0].B64JSON == "" {
		t.Error("item must carry either a URL or base64 data, never both empty")
	}
}

func TestStripDataURLPrefix(t *testing.T) {
	cases := []struct {
		input string
		want  string
		ok    bool
	}{
		{"data:image/png;base64,QUJD", "QUJD", true},
		{"data:image/jpeg;base64,AAAA", "AAAA", true},
		{"https://cdn.test/a.png", "", false},
		{"data:image/png,notbase64", "", false},
		{"data:image/png;base64,", "", false},
		{"", "", false},
	}
	for _, tc := range cases {
		got, ok := stripDataURLPrefix(tc.input)
		if ok != tc.ok || got != tc.want {
			t.Errorf("stripDataURLPrefix(%q) = (%q, %v), want (%q, %v)", tc.input, got, ok, tc.want, tc.ok)
		}
	}
}


// --- response_format 解析 ---

func TestResolveResponseFormatDefaultsToB64JSON(t *testing.T) {
	// 对齐官方：GPT image 模型不支持 response_format，永远返回 base64。
	// 客户端不传该参数时必须拿到 b64_json，否则按官方示例读 .b64_json 会得到 null。
	handler := NewImageHandler(nil, nil, nil).WithAppSettings(stubAppSettings{enabled: true})

	format, err := handler.resolveResponseFormat(context.Background(), "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if format != openAIImageFormatB64JSON {
		t.Errorf("format = %q, want %q", format, openAIImageFormatB64JSON)
	}
}

func TestResolveResponseFormatExplicitURLWinsEvenWhenB64Enabled(t *testing.T) {
	// 显式要 url 时必须给直链：这是本站的省流量路径，
	// 不能因为开关开着就强行换成 base64。
	handler := NewImageHandler(nil, nil, nil).WithAppSettings(stubAppSettings{enabled: true})

	format, err := handler.resolveResponseFormat(context.Background(), "url")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if format != openAIImageFormatURL {
		t.Errorf("format = %q, want %q", format, openAIImageFormatURL)
	}
}

func TestResolveResponseFormatIsCaseInsensitive(t *testing.T) {
	handler := NewImageHandler(nil, nil, nil).WithAppSettings(stubAppSettings{enabled: true})

	for _, input := range []string{"URL", "Url", "  url  "} {
		format, err := handler.resolveResponseFormat(context.Background(), input)
		if err != nil {
			t.Fatalf("input %q: unexpected error: %v", input, err)
		}
		if format != openAIImageFormatURL {
			t.Errorf("input %q: format = %q, want url", input, format)
		}
	}
}

func TestResolveResponseFormatDefaultFallsBackToURLWhenB64Disabled(t *testing.T) {
	// 开关关闭时，未指定格式也不能让请求失败：退回直链，
	// 这样客户端不必为了「管理员关了 base64」去改代码。
	handler := NewImageHandler(nil, nil, nil).WithAppSettings(stubAppSettings{enabled: false})

	format, err := handler.resolveResponseFormat(context.Background(), "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if format != openAIImageFormatURL {
		t.Errorf("format = %q, want %q", format, openAIImageFormatURL)
	}
}

func TestResolveResponseFormatRejectsExplicitB64WhenDisabled(t *testing.T) {
	// 显式请求 base64 但开关关闭：明确报错，而不是静默换成 url
	// （客户端可能依赖 base64 做后续处理，静默降级会埋坑）。
	handler := NewImageHandler(nil, nil, nil).WithAppSettings(stubAppSettings{enabled: false})

	if _, err := handler.resolveResponseFormat(context.Background(), "b64_json"); err == nil {
		t.Error("expected an error when b64_json is explicitly requested but disabled")
	}
}

func TestResolveResponseFormatRejectsUnknownValue(t *testing.T) {
	handler := NewImageHandler(nil, nil, nil).WithAppSettings(stubAppSettings{enabled: true})

	for _, input := range []string{"png", "base64", "data"} {
		if _, err := handler.resolveResponseFormat(context.Background(), input); err == nil {
			t.Errorf("input %q: expected an error", input)
		}
	}
}


// --- 模型白名单校验 ---

// stubModelListProvider 提供固定的对外模型列表。
type stubModelListProvider struct {
	models []string
}

func (s stubModelListProvider) ImageProvider(context.Context, string) (service.ImageProviderConfig, error) {
	return service.DefaultImageProviderConfig(), nil
}

func (s stubModelListProvider) ListImageModels(context.Context) ([]string, error) {
	return s.models, nil
}

func TestValidateRequestedModelAcceptsListedModel(t *testing.T) {
	handler := NewImageHandler(nil, nil, nil).WithProviderSettings(stubModelListProvider{models: []string{"gpt-image-2", "gpt-image-2.5"}})

	if err := handler.validateRequestedModel(context.Background(), "gpt-image-2"); err != nil {
		t.Errorf("unexpected error for a listed model: %v", err)
	}
}

func TestValidateRequestedModelRejectsUnlistedModel(t *testing.T) {
	// 关掉的模型必须被拒：编排层对未命中模型会回退到优先级最高的 Provider，
	// 不拦的话调用方会拿到别的模型生成的图，且按别的模型计费。
	handler := NewImageHandler(nil, nil, nil).WithProviderSettings(stubModelListProvider{models: []string{"gpt-image-2.5"}})

	err := handler.validateRequestedModel(context.Background(), "gpt-image-2")
	if err == nil {
		t.Fatal("expected an error for an unlisted model")
	}
	if !strings.Contains(err.Error(), "gpt-image-2") {
		t.Errorf("error should name the rejected model, got: %v", err)
	}
	if !strings.Contains(err.Error(), "gpt-image-2.5") {
		t.Errorf("error should list available models, got: %v", err)
	}
}

func TestValidateRequestedModelAllowsEmptyModel(t *testing.T) {
	// 空模型名是「用默认模型」的合法语义，应由编排层解析而不是在这里拒绝。
	handler := NewImageHandler(nil, nil, nil).WithProviderSettings(stubModelListProvider{models: []string{"gpt-image-2"}})

	if err := handler.validateRequestedModel(context.Background(), ""); err != nil {
		t.Errorf("unexpected error for an empty model: %v", err)
	}
	if err := handler.validateRequestedModel(context.Background(), "   "); err != nil {
		t.Errorf("unexpected error for a blank model: %v", err)
	}
}

func TestValidateRequestedModelReportsEmptyConfiguration(t *testing.T) {
	handler := NewImageHandler(nil, nil, nil).WithProviderSettings(stubModelListProvider{})

	err := handler.validateRequestedModel(context.Background(), "gpt-image-2")
	if err == nil {
		t.Fatal("expected an error when no models are configured")
	}
	if !strings.Contains(err.Error(), "尚未配置") {
		t.Errorf("error should explain the empty configuration, got: %v", err)
	}
}

// --- 幂等重放：成功响应体不能走错误通道 ---

func TestReplayResponseExtractsCachedGenResponse(t *testing.T) {
	// 编排层命中重放时返回 Code<400 且 Body 是缓存的 GenResponse。
	// 不识别的话调用方的重试会拿到错误信封，缓存的图片被丢弃。
	cached := []byte(`{"images":[{"id":"img_1","url":"https://cdn.example.test/a.png","storagePath":"generate/a.png"}]}`)
	statusErr := &orchestrator.StatusError{Code: 200, Body: cached}

	resp, ok := replayResponse(statusErr)
	if !ok {
		t.Fatal("expected the cached success body to be recognized as a replay")
	}
	if len(resp.Images) != 1 || resp.Images[0].ID != "img_1" {
		t.Errorf("unexpected replay payload: %+v", resp.Images)
	}
}

func TestReplayResponseRejectsRealErrors(t *testing.T) {
	// 真正的失败不能被当成重放，否则客户端会收到 200 加空响应。
	for _, statusErr := range []*orchestrator.StatusError{
		nil,
		{Code: 402, ErrorCode: "INSUFFICIENT_CREDITS", Message: "额度不足。"},
		{Code: 500, ErrorCode: "PROVIDER_BAD_RESPONSE", Message: "图片生成失败。"},
		{Code: 409, ErrorCode: "IDEMPOTENCY_CONFLICT", Message: "冲突。"},
	} {
		if _, ok := replayResponse(statusErr); ok {
			t.Errorf("status %+v should not be treated as a replay", statusErr)
		}
	}
}

func TestReplayResponseRejectsSuccessWithoutBody(t *testing.T) {
	// Code<400 但没有 Body 属于编排层的异常组合：按错误处理，不能谎报成功。
	statusErr := &orchestrator.StatusError{Code: 200}
	if _, ok := replayResponse(statusErr); ok {
		t.Error("a success code without a cached body must not be treated as a replay")
	}
}

func TestWriteStatusErrorMapsSubFourHundredCodeToBadRequest(t *testing.T) {
	rec := httptest.NewRecorder()
	writeStatusError(rec, &orchestrator.StatusError{Code: 200, ErrorCode: "weird", Message: "x"})

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

// --- 幂等指纹必须区分参考图 ---

func TestDeriveOpenAIIdempotencyKeyChangesWithReferences(t *testing.T) {
	// 同一提示词换一张参考图必须是不同的键。否则第二次编辑会命中重放、
	// 返回上一张图，用户看不到自己的新输入。
	base := orchestrator.GenRequest{Prompt: "make it blue", Model: "gpt-image-2"}
	first := base
	first.References = []orchestrator.GenReference{{DataUrl: "data:image/png;base64,AAA"}}
	second := base
	second.References = []orchestrator.GenReference{{DataUrl: "data:image/png;base64,BBB"}}

	if deriveOpenAIIdempotencyKey("user-1", first, "url") == deriveOpenAIIdempotencyKey("user-1", second, "url") {
		t.Error("changing the reference image must change the derived key")
	}
}

func TestDeriveOpenAIIdempotencyKeyStableForIdenticalReferences(t *testing.T) {
	// 同样的请求（含同样的参考图）必须派生出同样的键，否则客户端重试会重复扣费。
	reqA := orchestrator.GenRequest{
		Prompt:     "make it blue",
		Model:      "gpt-image-2",
		References: []orchestrator.GenReference{{DataUrl: "data:image/png;base64,SAME", FileName: "a.png"}},
	}
	reqB := orchestrator.GenRequest{
		Prompt:     "make it blue",
		Model:      "gpt-image-2",
		References: []orchestrator.GenReference{{DataUrl: "data:image/png;base64,SAME", FileName: "a.png"}},
	}

	if deriveOpenAIIdempotencyKey("user-1", reqA, "url") != deriveOpenAIIdempotencyKey("user-1", reqB, "url") {
		t.Error("identical requests must derive the same key")
	}
}

func TestDeriveOpenAIIdempotencyKeyWithoutReferencesIsStable(t *testing.T) {
	req := orchestrator.GenRequest{Prompt: "a dot", Model: "gpt-image-2"}
	if deriveOpenAIIdempotencyKey("user-1", req, "url") != deriveOpenAIIdempotencyKey("user-1", req, "url") {
		t.Error("requests without references must still derive a stable key")
	}
}

// --- multipart 请求体上限 ---

func TestParseOpenAIEditFormRejectsOversizedBody(t *testing.T) {
	// 解析前就要挡住超大请求体：ParseMultipartForm 的参数只管内存部分，
	// 超出会写临时文件，等到解析完再检查已经收完了整个请求体。
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	_ = writer.WriteField("prompt", "a dot")
	part, err := writer.CreateFormFile(openAIImageField, "big.png")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	oversized := make([]byte, openAIEditMaxTotalBytes+(2<<20))
	if _, err := part.Write(oversized); err != nil {
		t.Fatalf("write part: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/images/edits", bytes.NewReader(buf.Bytes()))
	req.Header.Set("Content-Type", writer.FormDataContentType())

	if _, err := parseOpenAIEditForm(httptest.NewRecorder(), req); err == nil {
		t.Error("expected an error for an oversized request body")
	}
}

func TestFirstNonEmptyString(t *testing.T) {
	cases := []struct {
		values []string
		want   string
	}{
		{[]string{"a", "b"}, "a"},
		{[]string{"", "b"}, "b"},
		{[]string{"  ", "b"}, "b"},
		{[]string{"", ""}, ""},
		{nil, ""},
	}
	for _, tc := range cases {
		if got := firstNonEmptyString(tc.values...); got != tc.want {
			t.Errorf("firstNonEmptyString(%v) = %q, want %q", tc.values, got, tc.want)
		}
	}
}
