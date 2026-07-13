package service

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var blockedImageSourceNetworks = []*net.IPNet{
	mustImageSourceCIDR("100.64.0.0/10"),
	mustImageSourceCIDR("192.0.0.0/24"),
	mustImageSourceCIDR("192.0.2.0/24"),
	mustImageSourceCIDR("198.18.0.0/15"),
	mustImageSourceCIDR("198.51.100.0/24"),
	mustImageSourceCIDR("203.0.113.0/24"),
	mustImageSourceCIDR("2001:db8::/32"),
}

func mustImageSourceCIDR(value string) *net.IPNet {
	_, network, err := net.ParseCIDR(value)
	if err != nil {
		panic(err)
	}
	return network
}

func newSafeImageHTTPClient(timeout time.Duration) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = safeImageDialContext
	return &http.Client{Timeout: timeout, Transport: transport}
}

func safeImageDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("invalid image source address: %w", err)
	}
	addresses, err := publicImageSourceAddresses(ctx, host)
	if err != nil {
		return nil, err
	}
	dialer := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}
	var lastErr error
	for _, address := range addresses {
		conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(address.String(), port))
		if dialErr == nil {
			return conn, nil
		}
		lastErr = dialErr
	}
	return nil, fmt.Errorf("failed to connect to image source: %w", lastErr)
}

func validateExternalImageURL(ctx context.Context, parsed *url.URL) error {
	if parsed == nil {
		return fmt.Errorf("image source URL is required")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("image source URL uses unsupported scheme %q", parsed.Scheme)
	}
	if parsed.User != nil {
		return fmt.Errorf("image source URL must not contain user credentials")
	}
	host := strings.TrimSpace(parsed.Hostname())
	if host == "" {
		return fmt.Errorf("image source URL has no host")
	}
	if strings.EqualFold(host, "localhost") || strings.HasSuffix(strings.ToLower(host), ".localhost") {
		return fmt.Errorf("image source host is not allowed")
	}
	_, err := publicImageSourceAddresses(ctx, host)
	return err
}

func publicImageSourceAddresses(ctx context.Context, host string) ([]net.IP, error) {
	var addresses []net.IP
	if literal := net.ParseIP(host); literal != nil {
		addresses = []net.IP{literal}
	} else {
		resolved, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, fmt.Errorf("resolve image source host: %w", err)
		}
		for _, address := range resolved {
			addresses = append(addresses, address.IP)
		}
	}
	if len(addresses) == 0 {
		return nil, fmt.Errorf("image source host has no addresses")
	}
	for _, address := range addresses {
		if !isAllowedImageSourceIP(address) {
			return nil, fmt.Errorf("image source host resolves to a disallowed address")
		}
	}
	return addresses, nil
}

func isAllowedImageSourceIP(address net.IP) bool {
	if address == nil || !address.IsGlobalUnicast() || address.IsPrivate() || address.IsLoopback() || address.IsLinkLocalUnicast() || address.IsLinkLocalMulticast() || address.IsUnspecified() || address.IsMulticast() {
		return false
	}
	for _, network := range blockedImageSourceNetworks {
		if network.Contains(address) {
			return false
		}
	}
	return true
}

func (s *StorageService) imageDownloadClient() *http.Client {
	base := s.client
	if base == nil {
		base = newSafeImageHTTPClient(120 * time.Second)
	}
	client := *base
	previousRedirect := client.CheckRedirect
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if err := validateExternalImageURL(req.Context(), req.URL); err != nil {
			return err
		}
		if previousRedirect != nil {
			return previousRedirect(req, via)
		}
		if len(via) >= 10 {
			return fmt.Errorf("stopped after 10 redirects")
		}
		return nil
	}
	return &client
}

func (s *StorageService) downloadImage(ctx context.Context, sourceURL string) ([]byte, string, error) {
	parsed, err := url.Parse(sourceURL)
	if err != nil {
		return nil, "", fmt.Errorf("failed to parse image source URL: %w", err)
	}
	if err := validateExternalImageURL(ctx, parsed); err != nil {
		return nil, "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, "", fmt.Errorf("failed to build download request: %w", err)
	}
	resp, err := s.imageDownloadClient().Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("failed to download image: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("failed to download image: status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxImageSize+1))
	if err != nil {
		return nil, "", fmt.Errorf("failed to read image data: %w", err)
	}
	if len(data) > maxImageSize {
		return nil, "", fmt.Errorf("image exceeds maximum size of %d bytes", maxImageSize)
	}
	return data, inferImageMime(resp.Header.Get("Content-Type")), nil
}
