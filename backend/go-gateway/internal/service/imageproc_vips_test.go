//go:build cgo

package service

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"testing"

	"github.com/davidbyttow/govips/v2/vips"
)

func TestMain(m *testing.M) {
	if err := vips.Startup(&vips.Config{ConcurrencyLevel: 1}); err != nil {
		panic(err)
	}
	code := m.Run()
	vips.Shutdown()
	os.Exit(code)
}

func TestExportThumbnailDoesNotMutateSourceImage(t *testing.T) {
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

func TestVipsCropToAspectRatio(t *testing.T) {
	fixture := image.NewRGBA(image.Rect(0, 0, 12, 8))
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, fixture); err != nil {
		t.Fatalf("encode fixture: %v", err)
	}
	processed, err := NewImageProcessor().CropToAspectRatio(encoded.Bytes(), 4, 5)
	if err != nil {
		t.Fatalf("CropToAspectRatio returned error: %v", err)
	}
	if processed.Width != 4 || processed.Height != 5 {
		t.Fatalf("cropped dimensions = %dx%d, want 4x5", processed.Width, processed.Height)
	}
}
