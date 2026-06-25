//go:build cgo

package main

import (
	"log"

	"github.com/davidbyttow/govips/v2/vips"
)

func initVips() {
	vips.Startup(&vips.Config{
		ConcurrencyLevel: 1,
		MaxCacheFiles:    0,
		MaxCacheMem:      50 * 1024 * 1024,
		MaxCacheSize:     100,
	})
	log.Println("libvips initialized")
}

func shutdownVips() {
	vips.Shutdown()
	log.Println("libvips shutdown")
}
