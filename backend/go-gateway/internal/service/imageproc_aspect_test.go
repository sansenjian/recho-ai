//go:build !cgo

package service

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestCropToAspectRatioCentersImage(t *testing.T) {
	fixture := image.NewRGBA(image.Rect(0, 0, 12, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 12; x++ {
			fixture.Set(x, y, color.RGBA{R: uint8(x * 10), G: uint8(y * 10), B: 100, A: 255})
		}
	}

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

	cropped, _, err := image.Decode(bytes.NewReader(processed.Data))
	if err != nil {
		t.Fatalf("decode cropped image: %v", err)
	}
	leftPixel := color.RGBAModel.Convert(cropped.At(0, 0)).(color.RGBA)
	if leftPixel.R != 40 {
		t.Fatalf("crop did not use the centered source region: left red = %d, want 40", leftPixel.R)
	}
}
