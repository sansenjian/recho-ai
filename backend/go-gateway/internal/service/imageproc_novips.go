//go:build !cgo

package service

import (
	"fmt"
	"path"
	"strings"
)

type noopProcessor struct{}

func newProcessorImpl() processorImpl {
	return &noopProcessor{}
}

// ProcessImage returns the original data unmodified and generates placeholder paths.
// This fallback is used when CGO/libvips is not available (e.g. local Windows development).
func (p *noopProcessor) ProcessImage(data []byte, pathHint string) (*ProcessedImage, error) {
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
	return &ProcessedImage{
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
	}, nil
}
