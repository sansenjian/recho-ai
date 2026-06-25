package service

import (
	"path"
	"strings"
)

// ProcessedVariant holds a single processed image variant.
type ProcessedVariant struct {
	Data  []byte
	Path  string
	URL   string
	Bytes int
	Mime  string
}

// ProcessedImage holds the original, preview, and thumbnail variants.
type ProcessedImage struct {
	Original  ProcessedVariant
	Preview   ProcessedVariant
	Thumbnail ProcessedVariant
	Width     int
	Height    int
}

// ImageProcessor processes images.
type ImageProcessor struct {
	impl processorImpl
}

// NewImageProcessor creates a new image processor.
func NewImageProcessor() *ImageProcessor {
	return &ImageProcessor{impl: newProcessorImpl()}
}

// ProcessImage takes raw image bytes, converts to WebP, and generates preview and thumbnail.
// The pathHint is used to build stable file paths for the variants.
func (p *ImageProcessor) ProcessImage(data []byte, pathHint string) (*ProcessedImage, error) {
	return p.impl.ProcessImage(data, pathHint)
}

type processorImpl interface {
	ProcessImage(data []byte, pathHint string) (*ProcessedImage, error)
}

// detectFormat identifies the image format from its magic bytes.
func detectFormat(data []byte) (mime, ext string) {
	if len(data) >= 2 && data[0] == 0xFF && data[1] == 0xD8 {
		return "image/jpeg", "jpg"
	}
	if len(data) >= len(pngMagic) && string(data[:len(pngMagic)]) == pngMagic {
		return "image/png", "png"
	}
	if len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
		return "image/webp", "webp"
	}
	if len(data) >= 6 && (string(data[0:6]) == "GIF87a" || string(data[0:6]) == "GIF89a") {
		return "image/gif", "gif"
	}
	return "image/png", "png"
}

const pngMagic = "\x89PNG\r\n\x1a\n"

// safePathPart sanitizes a storage path (which may include nested segments)
// for use as an object key. Unlike handler.safePathPart in
// internal/handler/image.go — which is stricter and disallows "/" and "." for
// URL path segments — this version permits "/" and "." so that multi-level
// storage prefixes are preserved. The two implementations are intentionally
// different to suit their respective contexts.
func safePathPart(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		value = fallback
	}
	value = strings.TrimPrefix(value, "/")
	var builder strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == '.' || r == '/' {
			builder.WriteRune(r)
		} else {
			builder.WriteByte('_')
		}
		if builder.Len() >= 160 {
			break
		}
	}
	result := strings.Trim(builder.String(), "/")
	// Normalize the path and reject any dot-dot segments that could escape the
	// intended storage prefix (e.g. "foo/../bar" or "../../secret").
	result = path.Clean("/" + result)
	result = strings.TrimPrefix(result, "/")
	if strings.Contains(result, "../") || strings.HasPrefix(result, "..") || result == ".." {
		return fallback
	}
	if result == "" || result == "." {
		return fallback
	}
	return result
}
