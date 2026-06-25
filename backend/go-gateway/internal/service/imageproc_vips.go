//go:build cgo

package service

import (
	"fmt"
	"path"
	"strings"

	"github.com/davidbyttow/govips/v2/vips"
)

const (
	previewQuality      = 86
	thumbnailQuality    = 72
	originalQuality     = 95
	thumbnailMaxSize    = 480
	webpLossless        = true
	losslessWebpQuality = 0
)

type vipsProcessor struct{}

func newProcessorImpl() processorImpl {
	return &vipsProcessor{}
}

// ProcessImage takes raw image bytes, converts to WebP, and generates preview and thumbnail.
func (p *vipsProcessor) ProcessImage(data []byte, pathHint string) (*ProcessedImage, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("empty image data")
	}

	img, err := vips.NewImageFromBuffer(data)
	if err != nil {
		return nil, fmt.Errorf("failed to load image: %w", err)
	}
	defer img.Close()

	if err := img.AutoRotate(); err != nil {
		return nil, fmt.Errorf("failed to auto-rotate image: %w", err)
	}

	width := img.Width()
	height := img.Height()

	originalBytes, originalMime, originalExt, err := p.exportOriginal(img, data)
	if err != nil {
		return nil, fmt.Errorf("failed to export original: %w", err)
	}

	previewBytes, err := p.exportPreview(img)
	if err != nil {
		return nil, fmt.Errorf("failed to export preview: %w", err)
	}

	thumbnailBytes, err := p.exportThumbnail(img)
	if err != nil {
		return nil, fmt.Errorf("failed to export thumbnail: %w", err)
	}

	safe := safePathPart(pathHint, "image")
	fileName := path.Base(safe)
	ext := path.Ext(fileName)
	name := strings.TrimSuffix(fileName, ext)
	if name == "" {
		name = "image"
	}
	dir := strings.TrimSuffix(safe, fileName)
	if dir != "" {
		dir = strings.TrimRight(dir, "/")
	}
	basePath := name
	if dir != "" {
		basePath = dir + "/" + name + "/" + name
	}

	originalPath := basePath + "." + originalExt
	previewPath := basePath + ".preview.webp"
	thumbnailPath := basePath + ".thumb.webp"

	return &ProcessedImage{
		Original: ProcessedVariant{
			Data:  originalBytes,
			Path:  originalPath,
			Bytes: len(originalBytes),
			Mime:  originalMime,
		},
		Preview: ProcessedVariant{
			Data:  previewBytes,
			Path:  previewPath,
			Bytes: len(previewBytes),
			Mime:  "image/webp",
		},
		Thumbnail: ProcessedVariant{
			Data:  thumbnailBytes,
			Path:  thumbnailPath,
			Bytes: len(thumbnailBytes),
			Mime:  "image/webp",
		},
		Width:  width,
		Height: height,
	}, nil
}

func (p *vipsProcessor) exportOriginal(img *vips.ImageRef, originalData []byte) ([]byte, string, string, error) {
	// Match Node.js behaviour: only PNG is converted to lossless WebP.
	// Other formats are re-encoded from the already AutoRotate()d image so that
	// the stored bytes and the reported width/height stay consistent for
	// orientation-corrected images.
	if len(originalData) >= len(pngMagic) && string(originalData[:len(pngMagic)]) == pngMagic {
		buf, mime, err := p.exportWebp(img, losslessWebpQuality, webpLossless)
		return buf, mime, "webp", err
	}

	mime, ext := detectFormat(originalData)
	switch ext {
	case "jpg":
		buf, err := img.JpegExport(&vips.JpegExportParams{
			Quality: originalQuality,
		})
		if err != nil {
			return nil, "", "", fmt.Errorf("failed to export jpeg original: %w", err)
		}
		return buf, mime, ext, nil
	case "webp":
		buf, _, err := p.exportWebp(img, originalQuality, false)
		if err != nil {
			return nil, "", "", err
		}
		return buf, mime, ext, nil
	default:
		// GIF and any other format libvips cannot write are passed through
		// untouched; this preserves animation for GIFs.
		return originalData, mime, ext, nil
	}
}

func (p *vipsProcessor) exportPreview(img *vips.ImageRef) ([]byte, error) {
	buf, _, err := p.exportWebp(img, previewQuality, false)
	return buf, err
}

func (p *vipsProcessor) exportThumbnail(img *vips.ImageRef) ([]byte, error) {
	// InterestingNone keeps the aspect ratio and fits inside the box without cropping,
	// matching sharp({ width: 480, height: 480, fit: 'inside' }).
	thumb, err := img.Thumbnail(thumbnailMaxSize, thumbnailMaxSize, vips.InterestingNone)
	if err != nil {
		return nil, fmt.Errorf("failed to create thumbnail: %w", err)
	}
	defer thumb.Close()

	buf, _, err := p.exportWebp(thumb, thumbnailQuality, false)
	return buf, err
}

func (p *vipsProcessor) exportWebp(img *vips.ImageRef, quality int, lossless bool) ([]byte, string, error) {
	params := vips.NewWebpExportParams()
	params.Q = quality
	params.Lossless = lossless
	buf, err := img.WebpExport(params)
	if err != nil {
		return nil, "", err
	}
	return buf, "image/webp", nil
}
