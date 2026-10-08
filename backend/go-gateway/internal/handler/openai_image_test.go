package handler

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"go-gateway/internal/orchestrator"
	"go-gateway/internal/repository"
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
		http.StatusUnauthorized:        "authentication_error",
		http.StatusForbidden:           "permission_error",
		http.StatusTooManyRequests:     "rate_limit_error",
		http.StatusInternalServerError: "server_error",
		http.StatusBadGateway:          "server_error",
		http.StatusBadRequest:          "invalid_request_error",
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
	// 必须在同一个 image 字段下放两个 part 才算测到多图：buildEditMultipart 用
	// map 存文件，同名 key 放不进两张，所以这里手工构造。
	req := buildEditMultipartWithParts(t, "combine these", []string{openAIImageField, openAIImageField}, [][]byte{tinyPNG, tinyPNG})

	form, err := parseOpenAIEditForm(httptest.NewRecorder(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(form.references) != 2 {
		t.Fatalf("got %d references, want 2", len(form.references))
	}
}

func TestParseOpenAIEditFormAcceptsImageArrayFieldNames(t *testing.T) {
	// image[] 是 OpenAI 的另一种字段写法，供应商与 SDK 都有使用。
	req := buildEditMultipartWithParts(t, "combine these", []string{openAIImageArrField, openAIImageArrField}, [][]byte{tinyPNG, tinyPNG})

	form, err := parseOpenAIEditForm(httptest.NewRecorder(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(form.references) != 2 {
		t.Fatalf("got %d references, want 2", len(form.references))
	}
}

func TestParseOpenAIEditFormMixesBothImageFieldNames(t *testing.T) {
	// 两种字段名混用时要合并计数，不能只取其中一个。
	req := buildEditMultipartWithParts(t, "combine these", []string{openAIImageField, openAIImageArrField}, [][]byte{tinyPNG, tinyPNG})

	form, err := parseOpenAIEditForm(httptest.NewRecorder(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(form.references) != 2 {
		t.Fatalf("got %d references, want 2", len(form.references))
	}
}

// buildEditMultipartWithParts 构造允许多个同名字段文件 part 的编辑请求。
func buildEditMultipartWithParts(t *testing.T, prompt string, fieldNames []string, contents [][]byte) *http.Request {
	t.Helper()
	if len(fieldNames) != len(contents) {
		t.Fatalf("fieldNames and contents must have equal length")
	}
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	if err := writer.WriteField("prompt", prompt); err != nil {
		t.Fatalf("write prompt: %v", err)
	}
	for index, name := range fieldNames {
		part, err := writer.CreateFormFile(name, fmt.Sprintf("part-%d.png", index))
		if err != nil {
			t.Fatalf("create file part %d: %v", index, err)
		}
		if _, err := part.Write(contents[index]); err != nil {
			t.Fatalf("write file part %d: %v", index, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/images/edits", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}

// --- mask（局部重绘蒙版） ---

// buildTestPNG 构造一张结构完整的最小 PNG，用于走过格式与 alpha 校验。
//
// 不直接用固定字节序列：新校验会解析 IHDR 的颜色类型，只有签名而无结构的
// 「伪 PNG」不再算合法，测试数据必须是一份真的能被解析的文件。
//
// colorType 取官方 PNG 规范的值：0 灰度、2 真彩、3 调色板、4 灰度+alpha、
// 6 真彩+alpha。带 tRNS 时额外插入一个透明块，用于覆盖调色板图的透明路径。
func buildTestPNG(colorType byte, withTRNS bool) []byte {
	var buf bytes.Buffer
	buf.Write([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a})

	writeChunk := func(chunkType string, payload []byte) {
		var length [4]byte
		binary.BigEndian.PutUint32(length[:], uint32(len(payload)))
		buf.Write(length[:])
		buf.WriteString(chunkType)
		buf.Write(payload)
		// CRC 校验不是本测试关心的事，占位即可——解析代码不读它。
		buf.Write([]byte{0, 0, 0, 0})
	}

	// IHDR：宽 1、高 1、位深 8、给定颜色类型、无压缩/滤波/隔行。
	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:4], 1)
	binary.BigEndian.PutUint32(ihdr[4:8], 1)
	ihdr[8] = 8
	ihdr[9] = colorType
	writeChunk("IHDR", ihdr)

	if withTRNS {
		// 调色板图的透明度由 tRNS 承载，必须出现在 IDAT 之前。
		writeChunk("tRNS", []byte{0, 0})
	}
	writeChunk("IDAT", []byte{0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01})
	writeChunk("IEND", nil)
	return buf.Bytes()
}

// minimalPNG 是一张合法的真彩+alpha PNG，作为 mask 的基准测试数据。
var minimalPNG = buildTestPNG(6, false)

func TestParseOpenAIEditFormParsesMask(t *testing.T) {
	// mask 要作为独立的 GenReference 带出去，编排层才能把它写成 multipart 的
	// mask 字段，而不是混进 image[] 当成又一张参考图。
	req, _ := buildEditMultipart(t, map[string]string{"prompt": "make it red"}, map[string][]byte{
		"image[]": minimalPNG,
		"mask":    minimalPNG,
	})

	form, err := parseOpenAIEditForm(httptest.NewRecorder(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if form.mask == nil {
		t.Fatal("mask must be parsed into the form")
	}
	if !strings.HasPrefix(form.mask.DataUrl, "data:image/png;base64,") {
		t.Errorf("mask must be carried as a PNG data URL, got %q", form.mask.DataUrl[:min(40, len(form.mask.DataUrl))])
	}
	if len(form.references) != 1 {
		t.Errorf("mask must not be counted as a reference image, got %d references", len(form.references))
	}
}

func TestParseOpenAIEditFormAllowsMissingMask(t *testing.T) {
	// 不传 mask 是合法的整图重绘，不能被拒绝。
	req, _ := buildEditMultipart(t, map[string]string{"prompt": "make it red"}, map[string][]byte{
		"image[]": minimalPNG,
	})

	form, err := parseOpenAIEditForm(httptest.NewRecorder(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if form.mask != nil {
		t.Error("a request without a mask must not invent one")
	}
}

func TestParseOpenAIEditFormRejectsNonPNGMask(t *testing.T) {
	// 官方要求 mask 是 PNG：它的语义依赖 alpha 通道。放一份 JPEG 过去，上游只会
	// 得到一张全不透明蒙版——等于什么都没改，却让人以为蒙版生效了。静默失效比
	// 直接报错更难排查，所以这里必须挡住。
	jpeg := []byte{0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 'J', 'F', 'I', 'F'}
	req, _ := buildEditMultipart(t, map[string]string{"prompt": "make it red"}, map[string][]byte{
		"image[]": minimalPNG,
		"mask":    jpeg,
	})

	_, err := parseOpenAIEditForm(httptest.NewRecorder(), req)
	if err == nil {
		t.Fatal("a non-PNG mask must be rejected")
	}
	if !strings.Contains(err.Error(), "PNG") {
		t.Errorf("the error must explain the PNG requirement, got %q", err.Error())
	}
}

func TestParseOpenAIEditFormRejectsOversizedMask(t *testing.T) {
	// 官方上限 4MB，比参考图的 50MB 严格。超限要在解析阶段挡掉，不能等到上游。
	oversized := append([]byte{}, minimalPNG...)
	oversized = append(oversized, make([]byte, openAIEditMaxMaskBytes+1)...)
	req, _ := buildEditMultipart(t, map[string]string{"prompt": "make it red"}, map[string][]byte{
		"image[]": minimalPNG,
		"mask":    oversized,
	})

	_, err := parseOpenAIEditForm(httptest.NewRecorder(), req)
	if err == nil {
		t.Fatal("an oversized mask must be rejected")
	}
	if !strings.Contains(err.Error(), "蒙版过大") {
		t.Errorf("the error must mention the size limit, got %q", err.Error())
	}
}

func TestIsPNG(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		want bool
	}{
		{"valid png signature", minimalPNG, true},
		{"jpeg", []byte{0xff, 0xd8, 0xff, 0xe0}, false},
		{"empty", nil, false},
		{"truncated signature", []byte{0x89, 'P', 'N', 'G'}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isPNG(tc.data); got != tc.want {
				t.Errorf("isPNG(%v) = %v, want %v", tc.data, got, tc.want)
			}
		})
	}
}

func TestPNGHasAlphaChannel(t *testing.T) {
	// mask 的语义完全依赖 alpha：只有透明处才会被重绘。不带 alpha 的图在蒙版
	// 位置上没有「透明」可言，放过去只会得到一张全不透明蒙版——静默失效。
	cases := []struct {
		name      string
		data      []byte
		wantAlpha bool
	}{
		{"truecolor with alpha (color type 6)", buildTestPNG(6, false), true},
		{"grayscale with alpha (color type 4)", buildTestPNG(4, false), true},
		{"palette with tRNS carries transparency", buildTestPNG(3, true), true},
		{"palette without tRNS has no transparency", buildTestPNG(3, false), false},
		{"truecolor without alpha (color type 2)", buildTestPNG(2, false), false},
		{"grayscale without alpha (color type 0)", buildTestPNG(0, false), false},
		{"not a png", []byte{0xff, 0xd8, 0xff, 0xe0}, false},
		{"signature only, no chunks", []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := pngHasAlphaChannel(tc.data); got != tc.wantAlpha {
				t.Errorf("pngHasAlphaChannel() = %v, want %v", got, tc.wantAlpha)
			}
		})
	}
}

func TestPNGHasAlphaChannelRejectsTruncatedChunk(t *testing.T) {
	// 块长度声称比实际数据还长时说明文件被截断，不能当作有效蒙版。
	data := buildTestPNG(6, false)
	var length [4]byte
	binary.BigEndian.PutUint32(length[:], 9999)
	broken := append(append([]byte{}, data[:8]...), length[:]...)
	broken = append(broken, []byte("IHDR")...)

	if pngHasAlphaChannel(broken) {
		t.Error("a chunk claiming more bytes than the file holds must not count as a valid mask")
	}
}

func TestParseOpenAIEditFormRejectsMaskWithoutAlpha(t *testing.T) {
	// 真彩无 alpha 的 PNG 结构上合法，但作为蒙版没有意义，必须拒绝并说明原因。
	req, _ := buildEditMultipart(t, map[string]string{"prompt": "make it red"}, map[string][]byte{
		"image[]": minimalPNG,
		"mask":    buildTestPNG(2, false),
	})

	_, err := parseOpenAIEditForm(httptest.NewRecorder(), req)
	if err == nil {
		t.Fatal("a mask without an alpha channel must be rejected")
	}
	if !strings.Contains(err.Error(), "alpha") {
		t.Errorf("the error must explain the alpha requirement, got %q", err.Error())
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
	data        []byte
	downloadErr error
	calls       int
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
	// 必须逐个字段核对：只断言数量和 ID 的话，即便解码把 URL/StoragePath
	// 丢掉（那正是「重放丢图」的表现）测试也照样通过。
	if len(resp.Images) != 1 {
		t.Fatalf("image count = %d, want 1", len(resp.Images))
	}
	image := resp.Images[0]
	if image.ID != "img_1" {
		t.Errorf("ID = %q, want %q", image.ID, "img_1")
	}
	if image.URL != "https://cdn.example.test/a.png" {
		t.Errorf("URL = %q, want the cached link", image.URL)
	}
	if image.StoragePath != "generate/a.png" {
		t.Errorf("StoragePath = %q, want the cached path", image.StoragePath)
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

	if deriveOpenAIIdempotencyKey("user-1", first, "url", time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)) == deriveOpenAIIdempotencyKey("user-1", second, "url", time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)) {
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

	if deriveOpenAIIdempotencyKey("user-1", reqA, "url", time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)) != deriveOpenAIIdempotencyKey("user-1", reqB, "url", time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)) {
		t.Error("identical requests must derive the same key")
	}
}

func TestDeriveOpenAIIdempotencyKeyWithoutReferencesIsStable(t *testing.T) {
	// 两个独立构造的相同请求必须落到同一个键，客户端重试才会命中重放。
	// 用同一个值自比没有意义（staticcheck SA4000），这里刻意构造两份。
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	first := orchestrator.GenRequest{Prompt: "a dot", Model: "gpt-image-2"}
	second := orchestrator.GenRequest{Prompt: "a dot", Model: "gpt-image-2"}

	if deriveOpenAIIdempotencyKey("user-1", first, "url", now) != deriveOpenAIIdempotencyKey("user-1", second, "url", now) {
		t.Error("identical requests must derive the same key")
	}
}

func TestDeriveOpenAIIdempotencyKeyIgnoresReferenceFieldWhenEmpty(t *testing.T) {
	// 无参考图时不能把空指纹拼进键：那会改变旧版本算出的键，滚动部署期间
	// 重试找不到旧记录，于是重新生成并再次扣费。
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	withoutField := orchestrator.GenRequest{Prompt: "a dot", Model: "gpt-image-2"}
	withEmptySlice := orchestrator.GenRequest{Prompt: "a dot", Model: "gpt-image-2", References: []orchestrator.GenReference{}}

	if deriveOpenAIIdempotencyKey("user-1", withoutField, "url", now) != deriveOpenAIIdempotencyKey("user-1", withEmptySlice, "url", now) {
		t.Error("an empty reference list must not change the derived key")
	}
}

func TestDeriveOpenAIIdempotencyKeyChangesAcrossTimeWindows(t *testing.T) {
	// 时间窗口让「相同参数再生成一张」成为新请求，而不是永远命中重放。
	// 窗口内必须稳定，跨窗口必须变化。
	request := orchestrator.GenRequest{Prompt: "a dot", Model: "gpt-image-2"}
	window := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

	sameWindowLater := window.Add(openAIIdempotencyWindow - time.Second)
	if deriveOpenAIIdempotencyKey("user-1", request, "url", window) != deriveOpenAIIdempotencyKey("user-1", request, "url", sameWindowLater) {
		t.Error("requests inside one window must share a key so retries still replay")
	}

	nextWindow := window.Add(openAIIdempotencyWindow)
	if deriveOpenAIIdempotencyKey("user-1", request, "url", window) == deriveOpenAIIdempotencyKey("user-1", request, "url", nextWindow) {
		t.Error("a request in the next window must be treated as new work")
	}
}

func TestIdempotencyWindowStartBucketsByWindow(t *testing.T) {
	window := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	start := idempotencyWindowStart(window)

	if got := idempotencyWindowStart(window.Add(openAIIdempotencyWindow - time.Second)); got != start {
		t.Errorf("same bucket expected: got %d want %d", got, start)
	}
	if got := idempotencyWindowStart(window.Add(openAIIdempotencyWindow)); got == start {
		t.Error("advancing one full window must start a new bucket")
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

func TestWriteReplayHeadersCopiesSignals(t *testing.T) {
	// X-Idempotent-Replay 让调用方知道这次复用了缓存而不是真的生成了新图。
	// 丢掉这些头会让客户端重试逻辑与用量监控失去判据。
	rec := httptest.NewRecorder()
	statusErr := &orchestrator.StatusError{
		Code:    200,
		Headers: map[string]string{"X-Idempotent-Replay": "true", "Content-Type": "application/json"},
		Body:    []byte(`{"images":[]}`),
	}

	writeReplayHeaders(rec, statusErr)

	if got := rec.Header().Get("X-Idempotent-Replay"); got != "true" {
		t.Errorf("X-Idempotent-Replay = %q, want %q", got, "true")
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q, want %q", got, "application/json")
	}
}

func TestWriteReplayHeadersToleratesNilHeaders(t *testing.T) {
	rec := httptest.NewRecorder()
	writeReplayHeaders(rec, &orchestrator.StatusError{Code: 200})

	if len(rec.Header()) != 0 {
		t.Errorf("expected no headers, got %v", rec.Header())
	}
}

// --- 跨时间桶的重试识别 ---

func TestResolveOpenAIIdempotencyKeyKeepsRetryInPreviousBucket(t *testing.T) {
	// 12:04:59 发出、12:05:01 重试：相隔两秒却跨过桶边界。只按当前桶派生会算出
	// 不同键，重试就会重新生成并再次扣费。
	first := time.Date(2026, 10, 8, 12, 4, 59, 0, time.UTC)
	retry := time.Date(2026, 10, 8, 12, 5, 1, 0, time.UTC)

	current := first
	stub := &stubImageIdempotencyService{}
	handler := NewImageHandler(nil, nil, nil).WithIdempotencyService(stub).WithClock(func() time.Time { return current })

	request := orchestrator.GenRequest{Prompt: "a dot", Model: "gpt-image-2"}

	original, err := handler.resolveOpenAIIdempotencyKey(context.Background(), "user-1", request, "url")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// 第一次请求占用了这个键，仓储里从此有它。键由服务端派生，桩无法预知，
	// 所以在这里回填，模拟真实的写入时序；CreatedAt 取刚刚，否则会被
	// openAIRetryReuseWindow 的时限挡掉。
	stub.lookupKeys = map[string]bool{original: true}
	stub.lookupRecord = &repository.IdempotencyRecord{ID: "just-created", CreatedAt: first}

	current = retry
	replayed, err := handler.resolveOpenAIIdempotencyKey(context.Background(), "user-1", request, "url")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if replayed != original {
		t.Errorf("a retry just across the bucket boundary must reuse the original key: original=%s retry=%s", original, replayed)
	}
}

func TestResolveOpenAIIdempotencyKeyDoesNotReuseStalePreviousRecord(t *testing.T) {
	// 上一桶留着很久以前的记录时，新请求必须是新键。
	//
	// CodeRabbit 指出过这一点：没有时限的话，任何撞上历史记录的新请求都会复用
	// 旧键并返回旧图，「再生成一张」永远失效。请求字节完全相同，服务端唯一能
	// 依据的区分信号是时间间隔。
	generatedAt := time.Date(2026, 10, 8, 12, 0, 30, 0, time.UTC)
	now := time.Date(2026, 10, 8, 12, 8, 0, 0, time.UTC) // 距生成 7.5 分钟

	request := orchestrator.GenRequest{Prompt: "a dot", Model: "gpt-image-2"}
	currentKey := deriveOpenAIIdempotencyKeyForWindow("user-1", request, "url", idempotencyWindowStart(now))
	previousKey := deriveOpenAIIdempotencyKeyForWindow("user-1", request, "url", idempotencyWindowStart(now)-int64(openAIIdempotencyWindow/time.Second))

	stub := &stubImageIdempotencyService{lookupKeys: map[string]bool{previousKey: true}}
	stub.lookupRecord = &repository.IdempotencyRecord{ID: "old", CreatedAt: generatedAt}
	handler := NewImageHandler(nil, nil, nil).WithIdempotencyService(stub).WithClock(func() time.Time { return now })

	got, err := handler.resolveOpenAIIdempotencyKey(context.Background(), "user-1", request, "url")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != currentKey {
		t.Errorf("a stale previous-window record must not be reused: got=%s want=%s", got, currentKey)
	}
}

func TestResolveOpenAIIdempotencyKeyPrefersCurrentBucketOverRecentPrevious(t *testing.T) {
	// 两桶都有记录时必须优先当前桶：它是更近的一次同参数请求。
	now := time.Date(2026, 10, 8, 12, 5, 1, 0, time.UTC)
	request := orchestrator.GenRequest{Prompt: "a dot", Model: "gpt-image-2"}

	currentKey := deriveOpenAIIdempotencyKeyForWindow("user-1", request, "url", idempotencyWindowStart(now))
	previousKey := deriveOpenAIIdempotencyKeyForWindow("user-1", request, "url", idempotencyWindowStart(now)-int64(openAIIdempotencyWindow/time.Second))

	stub := &stubImageIdempotencyService{lookupKeys: map[string]bool{currentKey: true, previousKey: true}}
	stub.lookupRecord = &repository.IdempotencyRecord{ID: "recent", CreatedAt: now.Add(-time.Second)}
	handler := NewImageHandler(nil, nil, nil).WithIdempotencyService(stub).WithClock(func() time.Time { return now })

	got, err := handler.resolveOpenAIIdempotencyKey(context.Background(), "user-1", request, "url")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != currentKey {
		t.Errorf("the current window must win when both windows have records: got=%s want=%s", got, currentKey)
	}
}

func TestResolveOpenAIIdempotencyKeyUsesCurrentBucketForNewWork(t *testing.T) {
	// 两个桶都没有记录时是全新请求，占用当前桶。
	request := orchestrator.GenRequest{Prompt: "a dot", Model: "gpt-image-2"}
	now := time.Date(2026, 10, 8, 12, 5, 1, 0, time.UTC)
	handler := NewImageHandler(nil, nil, nil).
		WithIdempotencyService(&stubImageIdempotencyService{}).
		WithClock(func() time.Time { return now })

	got, err := handler.resolveOpenAIIdempotencyKey(context.Background(), "user-1", request, "url")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := deriveOpenAIIdempotencyKey("user-1", request, "url", now)
	if got != want {
		t.Errorf("a fresh request must take the current window key: got=%s want=%s", got, want)
	}
}

func TestResolveOpenAIIdempotencyKeyPropagatesLookupFailure(t *testing.T) {
	// CodeRabbit 指出：把查询失败当成「没有旧记录」会在查询瞬时抖动的窗口里让
	// 重试重复扣费——上一桶可能已有成功记录，此刻新建就是又生成一张。
	// 解析器必须把错误交给调用方，由调用方拒绝这次请求。
	//
	// 只让首次查询失败：若解析器吞掉首个错误继续探测，第二次查询会成功并
	// 返回当前桶的键，测试就会漏判——那正是这个用例要挡住的行为。
	now := time.Date(2026, 10, 8, 12, 5, 1, 0, time.UTC)
	request := orchestrator.GenRequest{Prompt: "a dot", Model: "gpt-image-2"}
	handler := NewImageHandler(nil, nil, nil).
		WithIdempotencyService(&stubImageIdempotencyService{lookupFailFirstOnly: true}).
		WithClock(func() time.Time { return now })

	if _, err := handler.resolveOpenAIIdempotencyKey(context.Background(), "user-1", request, "url"); err == nil {
		t.Error("a lookup failure must be reported so the caller can refuse to create a new key")
	}
}

func TestResolveOpenAIIdempotencyKeyWithoutServiceUsesCurrentWindow(t *testing.T) {
	// 没有幂等服务时退化为只按当前桶，行为与未引入跨桶解析时一致。
	request := orchestrator.GenRequest{Prompt: "a dot", Model: "gpt-image-2"}
	now := time.Date(2026, 10, 8, 12, 5, 1, 0, time.UTC)
	handler := NewImageHandler(nil, nil, nil).WithClock(func() time.Time { return now })

	got, err := handler.resolveOpenAIIdempotencyKey(context.Background(), "user-1", request, "url")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := deriveOpenAIIdempotencyKey("user-1", request, "url", now)
	if got != want {
		t.Errorf("without an idempotency service the current window key must be used: got=%s want=%s", got, want)
	}
}

func TestDeriveOpenAIIdempotencyKeyForWindowMatchesWindowStart(t *testing.T) {
	// 按窗口起点派生与按时刻派生必须一致，否则探测上一桶会算出错误的候选键。
	request := orchestrator.GenRequest{Prompt: "a dot", Model: "gpt-image-2"}
	now := time.Date(2026, 10, 8, 12, 7, 33, 0, time.UTC)

	byTime := deriveOpenAIIdempotencyKey("user-1", request, "url", now)
	byWindow := deriveOpenAIIdempotencyKeyForWindow("user-1", request, "url", idempotencyWindowStart(now))

	if byTime != byWindow {
		t.Errorf("window-start derivation must match time-based derivation: %s vs %s", byTime, byWindow)
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
