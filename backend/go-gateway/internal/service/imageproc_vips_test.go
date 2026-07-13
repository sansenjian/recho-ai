//go:build cgo

package service

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"

	"github.com/davidbyttow/govips/v2/vips"
)

func TestExportThumbnailDoesNotMutateSourceImage(t *testing.T) {
	if err := vips.Startup(&vips.Config{ConcurrencyLevel: 1}); err != nil {
		t.Fatalf("start libvips: %v", err)
	}
	defer vips.Shutdown()

	fixture := image.NewRGBA(image.Rect(0, 0, 800, 600))
	for y := 0; y < fixture.Bounds().Dy(); y++ {
		for x := 0; x < fixture.Bounds().Dx(); x++ {
			fixture.SetRGBA(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 127, A: 255})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, fixture); err != nil {
		t.Fatalf("encode fixture: %v", err)
	}

	img, err := vips.NewImageFromBuffer(encoded.Bytes())
	if err != nil {
		t.Fatalf("load fixture: %v", err)
	}
	defer img.Close()
	wantWidth, wantHeight := img.Width(), img.Height()

	processor := &vipsProcessor{}
	if _, err := processor.exportThumbnail(img); err != nil {
		t.Fatalf("exportThumbnail() error = %v", err)
	}
	if img.Width() != wantWidth || img.Height() != wantHeight {
		t.Fatalf("exportThumbnail mutated source dimensions to %dx%d, want %dx%d", img.Width(), img.Height(), wantWidth, wantHeight)
	}
}
