package supabase

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Client wraps a PostgreSQL connection pool for Supabase
type Client struct {
	pool *pgxpool.Pool
}

// NewClient creates a new Supabase client with a connection pool
func NewClient() (*Client, error) {
	connString := os.Getenv("DATABASE_URL")
	if connString == "" {
		// Fallback: construct from individual env vars (Supabase pattern)
		url := os.Getenv("SUPABASE_URL")
		if url == "" {
			return nil, fmt.Errorf("DATABASE_URL or SUPABASE_URL is required")
		}
		// Supabase uses a specific connection string format
		connString = os.Getenv("POSTGRES_URL")
		if connString == "" {
			return nil, fmt.Errorf("POSTGRES_URL environment variable is required")
		}
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

	// Connection pool settings optimized for serverless
	poolConfig.MaxConns = 10
	poolConfig.MinConns = 0
	poolConfig.MaxConnLifetime = time.Hour
	poolConfig.MaxConnIdleTime = 5 * time.Minute

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	// Verify connection
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &Client{pool: pool}, nil
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
