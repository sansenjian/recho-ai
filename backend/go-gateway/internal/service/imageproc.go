package service

import (
	"fmt"
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

// ImageProcessOptions controls which processed variants are generated.
// OnlyOriginal keeps validation/normalization of the source image while
// skipping gallery preview and thumbnail work for reference uploads.
type ImageProcessOptions struct {
	OnlyOriginal bool
}

type CroppedImage struct {
	Data   []byte
	Mime   string
	Width  int
	Height int
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
func (p *ImageProcessor) ProcessImage(data []byte, pathHint string, options ...ImageProcessOptions) (*ProcessedImage, error) {
	return p.impl.ProcessImage(data, pathHint, options...)
}

func (p *ImageProcessor) CropToAspectRatio(data []byte, ratioWidth, ratioHeight int) (*CroppedImage, error) {
	return p.impl.CropToAspectRatio(data, ratioWidth, ratioHeight)
}

type processorImpl interface {
	ProcessImage(data []byte, pathHint string, options ...ImageProcessOptions) (*ProcessedImage, error)
	CropToAspectRatio(data []byte, ratioWidth, ratioHeight int) (*CroppedImage, error)
}

func centeredCropDimensions(width, height, ratioWidth, ratioHeight int) (left, top, cropWidth, cropHeight int, err error) {
	if width < 1 || height < 1 || ratioWidth < 1 || ratioHeight < 1 {
		return 0, 0, 0, 0, fmt.Errorf("image and ratio dimensions must be positive")
	}

	scale := min(width/ratioWidth, height/ratioHeight)
	if scale < 1 {
		return 0, 0, 0, 0, fmt.Errorf("aspect ratio produces an empty crop")
	}
	cropWidth = scale * ratioWidth
	cropHeight = scale * ratioHeight
	return (width - cropWidth) / 2, (height - cropHeight) / 2, cropWidth, cropHeight, nil
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
