//go:build !cgo

package main

func initVips() {
	// No-op when libvips is not available.
}

func shutdownVips() {
	// No-op when libvips is not available.
}
