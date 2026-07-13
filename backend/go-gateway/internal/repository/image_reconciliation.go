package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"go-gateway/internal/reconciliation"
)

type imageReconciliationDB interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

type ImageReconciliationRepository struct {
	db imageReconciliationDB
}

func NewImageReconciliationRepository(pool imageReconciliationDB) *ImageReconciliationRepository {
	return &ImageReconciliationRepository{db: pool}
}

func (r *ImageReconciliationRepository) BeginRun(ctx context.Context, startedAt time.Time) (string, error) {
	var id string
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.image_reconciliation_runs (status, started_at)
		VALUES ('running', $1)
		RETURNING id
	`, startedAt).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("begin image reconciliation run: %w", err)
	}
	return id, nil
}

func (r *ImageReconciliationRepository) FindStaleJobs(ctx context.Context, cutoff time.Time, limit int) ([]reconciliation.StaleImageJob, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, status, updated_at
		FROM public.image_generation_jobs
		WHERE status IN ('staging', 'persistence_processing', 'refund_pending')
		  AND updated_at < $1
		ORDER BY updated_at
		LIMIT $2
	`, cutoff, limit)
	if err != nil {
		return nil, fmt.Errorf("find stale image jobs: %w", err)
	}
	defer rows.Close()
	var jobs []reconciliation.StaleImageJob
	for rows.Next() {
		var job reconciliation.StaleImageJob
		if err := rows.Scan(&job.ID, &job.Status, &job.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan stale image job: %w", err)
		}
		jobs = append(jobs, job)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read stale image jobs: %w", err)
	}
	return jobs, nil
}

func (r *ImageReconciliationRepository) ListReferencedObjectPaths(ctx context.Context) ([]string, error) {
	paths := make([]string, 0)
	rows, err := r.db.Query(ctx, `
		SELECT storage_path, preview_path, thumbnail_path
		FROM public.image_generations
		WHERE storage_path IS NOT NULL OR preview_path IS NOT NULL OR thumbnail_path IS NOT NULL
	`)
	if err != nil {
		return nil, fmt.Errorf("query image history object paths: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var storagePath, previewPath, thumbnailPath *string
		if err := rows.Scan(&storagePath, &previewPath, &thumbnailPath); err != nil {
			return nil, fmt.Errorf("scan image history object paths: %w", err)
		}
		paths = appendNullablePaths(paths, storagePath, previewPath, thumbnailPath)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read image history object paths: %w", err)
	}

	jobRows, err := r.db.Query(ctx, `
		SELECT result_manifest
		FROM public.image_generation_jobs
		WHERE status IN ('staging', 'persistence_pending', 'persistence_processing', 'refund_pending')
	`)
	if err != nil {
		return nil, fmt.Errorf("query image job manifests: %w", err)
	}
	defer jobRows.Close()
	for jobRows.Next() {
		var raw json.RawMessage
		if err := jobRows.Scan(&raw); err != nil {
			return nil, fmt.Errorf("scan image job manifest: %w", err)
		}
		paths = append(paths, manifestObjectPaths(raw)...)
	}
	if err := jobRows.Err(); err != nil {
		return nil, fmt.Errorf("read image job manifests: %w", err)
	}
	return paths, nil
}

func (r *ImageReconciliationRepository) RecordFinding(ctx context.Context, finding reconciliation.Finding) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.image_reconciliation_findings (run_id, kind, subject, status, detail, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (run_id, kind, subject) DO NOTHING
	`, finding.RunID, finding.Kind, finding.Subject, finding.Status, finding.Detail, finding.CreatedAt)
	if err != nil {
		return fmt.Errorf("record image reconciliation finding: %w", err)
	}
	return nil
}

func (r *ImageReconciliationRepository) CompleteRun(ctx context.Context, summary reconciliation.RunSummary) error {
	_, err := r.db.Exec(ctx, `
		UPDATE public.image_reconciliation_runs
		SET status = $2,
		    finished_at = $3,
		    stale_jobs = $4,
		    orphan_objects = $5,
		    deleted_objects = $6,
		    error_detail = NULLIF($7, '')
		WHERE id = $1
	`, summary.RunID, summary.Status, summary.FinishedAt, summary.StaleJobs, summary.OrphanObjects, summary.DeletedObjects, summary.Error)
	if err != nil {
		return fmt.Errorf("complete image reconciliation run: %w", err)
	}
	return nil
}

func appendNullablePaths(paths []string, values ...*string) []string {
	for _, value := range values {
		if value != nil && *value != "" {
			paths = append(paths, *value)
		}
	}
	return paths
}

func manifestObjectPaths(raw json.RawMessage) []string {
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return nil
	}
	var paths []string
	var visit func(any)
	visit = func(node any) {
		switch typed := node.(type) {
		case map[string]any:
			for key, child := range typed {
				switch key {
				case "storagePath", "previewPath", "thumbnailPath", "stagedPath":
					if path, ok := child.(string); ok && path != "" {
						paths = append(paths, path)
					}
				}
				visit(child)
			}
		case []any:
			for _, child := range typed {
				visit(child)
			}
		}
	}
	visit(value)
	return paths
}
