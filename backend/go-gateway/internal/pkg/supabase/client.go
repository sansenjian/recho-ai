package supabase

import (
	"context"
	"fmt"
	"os"
	"time"

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
