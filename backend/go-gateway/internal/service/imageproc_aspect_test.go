//go:build !cgo

package service

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
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

func TestCropToAspectRatioHonorsEXIFOrientation(t *testing.T) {
	fixture := image.NewRGBA(image.Rect(0, 0, 6, 4))
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, fixture, &jpeg.Options{Quality: 100}); err != nil {
		t.Fatalf("encode fixture: %v", err)
	}

	oriented := jpegWithEXIFOrientation(t, encoded.Bytes(), 6)
	processed, err := NewImageProcessor().CropToAspectRatio(oriented, 2, 3)
	if err != nil {
		t.Fatalf("CropToAspectRatio returned error: %v", err)
	}
	if processed.Width != 4 || processed.Height != 6 {
		t.Fatalf("oriented crop dimensions = %dx%d, want 4x6", processed.Width, processed.Height)
	}
}

func jpegWithEXIFOrientation(t *testing.T, data []byte, orientation byte) []byte {
	t.Helper()
	if len(data) < 2 || data[0] != 0xff || data[1] != 0xd8 {
		t.Fatal("fixture is not a JPEG")
	}
	payload := []byte{
		'E', 'x', 'i', 'f', 0, 0,
		'I', 'I', 42, 0, 8, 0, 0, 0,
		1, 0,
		0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0,
		0, 0, 0, 0,
	}
	result := make([]byte, 0, len(data)+len(payload)+4)
	result = append(result, data[:2]...)
	result = append(result, 0xff, 0xe1)
	length := make([]byte, 2)
	binary.BigEndian.PutUint16(length, uint16(len(payload)+2))
	result = append(result, length...)
	result = append(result, payload...)
	return append(result, data[2:]...)
}
