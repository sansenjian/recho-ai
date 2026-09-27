package supabase

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/net/proxy"

	"go-gateway/internal/config"
)

// Client wraps a PostgreSQL connection pool for Supabase
type Client struct {
	pool *pgxpool.Pool
}

// NewClient creates a new Supabase client with a connection pool.
// It retries up to 3 times with 3-second intervals to handle cold-start
// DNS/network delays on serverless platforms like Render.
func NewClient() (*Client, error) {
	connString := os.Getenv("DATABASE_URL")
	if connString == "" {
		connString = os.Getenv("POSTGRES_URL")
	}
	if connString == "" {
		return nil, fmt.Errorf("DATABASE_URL or POSTGRES_URL is required")
	}

	poolConfig, err := pgxpool.ParseConfig(connString)
	if err != nil {
		return nil, fmt.Errorf("failed to parse database config: %w", err)
	}

	// When connecting through Supabase PgBouncer (transaction mode), pgx's
	// prepared statement cache causes "prepared statement already exists"
	// (SQLSTATE 42P05) because named statements are not visible across
	// PgBouncer-routed sessions. Detect PgBouncer and switch to simple
	// extended protocol (Exec) that skips the prepare step.
	if isPgBouncerURL(connString) {
		poolConfig.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
	}

	if err := configureSocks5Proxy(poolConfig, config.DatabaseSocks5Proxy); err != nil {
		return nil, err
	}

	// Connection pool settings optimized for serverless
	poolConfig.MaxConns = 10
	poolConfig.MinConns = 0
	poolConfig.MaxConnLifetime = time.Hour
	poolConfig.MaxConnIdleTime = 5 * time.Minute

	maxRetries := envInt("DB_CONNECT_MAX_RETRIES", 3)
	retryInterval := time.Duration(envInt("DB_CONNECT_RETRY_INTERVAL_SECONDS", 3)) * time.Second
	perAttemptTimeout := time.Duration(envInt("DB_CONNECT_TIMEOUT_SECONDS", 15)) * time.Second

	var pool *pgxpool.Pool
	var lastErr error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), perAttemptTimeout)
		pool, err = pgxpool.NewWithConfig(ctx, poolConfig)
		if err != nil {
			cancel()
			lastErr = fmt.Errorf("failed to create connection pool (attempt %d/%d): %w", attempt, maxRetries, err)
			log.Printf("[supabase] %v", lastErr)
			if attempt < maxRetries {
				time.Sleep(retryInterval)
			}
			continue
		}

		// Verify connection
		if err = pool.Ping(ctx); err != nil {
			pool.Close()
			cancel()
			lastErr = fmt.Errorf("failed to ping database (attempt %d/%d): %w", attempt, maxRetries, err)
			log.Printf("[supabase] %v", lastErr)
			if attempt < maxRetries {
				time.Sleep(retryInterval)
			}
			continue
		}

		cancel()
		log.Printf("[supabase] database connection established on attempt %d/%d", attempt, maxRetries)
		return &Client{pool: pool}, nil
	}

	return nil, lastErr
}

func configureSocks5Proxy(poolConfig *pgxpool.Config, proxyValue string) error {
	proxyValue = strings.TrimSpace(proxyValue)
	if proxyValue == "" {
		return nil
	}

	proxyURL, err := url.Parse(proxyValue)
	if err != nil || proxyURL.Host == "" || (proxyURL.Scheme != "socks5" && proxyURL.Scheme != "socks5h") {
		return fmt.Errorf("invalid DATABASE_SOCKS5_PROXY configuration")
	}

	var auth *proxy.Auth
	if username := proxyURL.User.Username(); username != "" {
		password, _ := proxyURL.User.Password()
		auth = &proxy.Auth{User: username, Password: password}
	}

	dialer, err := proxy.SOCKS5("tcp", proxyURL.Host, auth, proxy.Direct)
	if err != nil {
		return fmt.Errorf("failed to configure DATABASE_SOCKS5_PROXY: %w", err)
	}

	poolConfig.ConnConfig.DialFunc = func(ctx context.Context, network, address string) (net.Conn, error) {
		if contextDialer, ok := dialer.(proxy.ContextDialer); ok {
			return contextDialer.DialContext(ctx, network, address)
		}
		return dialer.Dial(network, address)
	}
	if proxyURL.Scheme == "socks5h" {
		poolConfig.ConnConfig.LookupFunc = func(_ context.Context, host string) ([]string, error) {
			return []string{host}, nil
		}
	}
	log.Printf("[supabase] PostgreSQL connections configured through SOCKS5 proxy %s", proxyURL.Host)
	return nil
}

// Close closes the connection pool
func (c *Client) Close() {
	if c.pool != nil {
		c.pool.Close()
	}
}

// Pool returns the underlying connection pool for advanced use
func (c *Client) Pool() *pgxpool.Pool {
	return c.pool
}

// Ping checks database connectivity
func (c *Client) Ping(ctx context.Context) error {
	return c.pool.Ping(ctx)
}

// isPgBouncerURL detects whether the connection string points to PgBouncer
// (Supabase pooler on port 6543 or hostname containing "pooler.supabase.com").
func isPgBouncerURL(connString string) bool {
	return strings.Contains(connString, "pooler.supabase.com") ||
		strings.Contains(connString, ":6543")
}

// envInt reads an integer environment variable or returns the given default.
func envInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if intVal, err := strconv.Atoi(val); err == nil {
			return intVal
		}
	}
	return defaultVal
}
