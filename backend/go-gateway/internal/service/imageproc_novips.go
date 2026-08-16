//go:build !cgo

package service

import (
	"bytes"
	"fmt"
	"image"
	"image/draw"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"path"
	"strings"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp"
)

func (p *noopProcessor) CropToAspectRatio(data []byte, ratioWidth, ratioHeight int) (*CroppedImage, error) {
	img, err := imaging.Decode(bytes.NewReader(data), imaging.AutoOrientation(true))
	if err != nil {
		return nil, fmt.Errorf("failed to decode image for cropping: %w", err)
	}
	bounds := img.Bounds()
	left, top, width, height, err := centeredCropDimensions(bounds.Dx(), bounds.Dy(), ratioWidth, ratioHeight)
	if err != nil {
		return nil, err
	}
	cropped := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(cropped, cropped.Bounds(), img, image.Pt(bounds.Min.X+left, bounds.Min.Y+top), draw.Src)

	var encoded bytes.Buffer
	if err := png.Encode(&encoded, cropped); err != nil {
		return nil, fmt.Errorf("failed to encode cropped image: %w", err)
	}
	return &CroppedImage{Data: encoded.Bytes(), Mime: "image/png", Width: width, Height: height}, nil
}

type noopProcessor struct{}

func newProcessorImpl() processorImpl {
	return &noopProcessor{}
}

// ProcessImage returns the original data unmodified and generates placeholder paths.
// This fallback is used when CGO/libvips is not available (e.g. local Windows development).
func (p *noopProcessor) ProcessImage(data []byte, pathHint string, options ...ImageProcessOptions) (*ProcessedImage, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("empty image data")
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

	mime, ext := detectFormat(data)
	processed := &ProcessedImage{
		Original: ProcessedVariant{
			Data:  data,
			Path:  basePath + "." + ext,
			Bytes: len(data),
			Mime:  mime,
		},
		Preview: ProcessedVariant{
			Data:  data,
			Path:  basePath + ".preview." + ext,
			Bytes: len(data),
			Mime:  mime,
		},
		Thumbnail: ProcessedVariant{
			Data:  data,
			Path:  basePath + ".thumb." + ext,
			Bytes: len(data),
			Mime:  mime,
		},
	}
	if len(options) > 0 && options[0].OnlyOriginal {
		processed.Preview = ProcessedVariant{}
		processed.Thumbnail = ProcessedVariant{}
	}
	return processed, nil
}
