// Package reconciliation contains durable image-job and object-store audits.
package reconciliation

import (
	"context"
	"fmt"
	"strings"
	"time"
)

const (
	RunStatusCompleted      = "completed"
	RunStatusFailed         = "failed"
	FindingKindStaleJob     = "stale_job"
	FindingKindOrphanObject = "orphan_object"
)

type StaleImageJob struct {
	ID        string
	Status    string
	UpdatedAt time.Time
}

type ObjectInfo struct {
	Path         string
	LastModified time.Time
}

type Finding struct {
	RunID     string
	Kind      string
	Subject   string
	Status    string
	Detail    string
	CreatedAt time.Time
}

type RunSummary struct {
	RunID          string
	Status         string
	StartedAt      time.Time
	FinishedAt     time.Time
	StaleJobs      int
	OrphanObjects  int
	DeletedObjects int
	Error          string
}

type Store interface {
	BeginRun(context.Context, time.Time) (string, error)
	FindStaleJobs(context.Context, time.Time, int) ([]StaleImageJob, error)
	ListReferencedObjectPaths(context.Context) ([]string, error)
	RecordFinding(context.Context, Finding) error
	CompleteRun(context.Context, RunSummary) error
}

type Storage interface {
	ListObjects(context.Context, string) ([]ObjectInfo, error)
	DeleteObjects(context.Context, ...string) error
}

type Options struct {
	StaleAfter  time.Duration
	OrphanGrace time.Duration
	JobLimit    int
}

type ImageReconciler struct {
	store   Store
	storage Storage
	options Options
}

func NewImageReconciler(store Store, storage Storage, options Options) *ImageReconciler {
	if options.StaleAfter <= 0 {
		options.StaleAfter = 30 * time.Minute
	}
	if options.OrphanGrace <= 0 {
		options.OrphanGrace = 24 * time.Hour
	}
	if options.JobLimit <= 0 {
		options.JobLimit = 500
	}
	return &ImageReconciler{store: store, storage: storage, options: options}
}

func (r *ImageReconciler) Run(ctx context.Context, now time.Time) (RunSummary, error) {
	if r == nil || r.store == nil || r.storage == nil {
		return RunSummary{}, fmt.Errorf("image reconciliation dependencies are not configured")
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	summary := RunSummary{StartedAt: now}
	runID, err := r.store.BeginRun(ctx, now)
	if err != nil {
		return summary, fmt.Errorf("begin image reconciliation run: %w", err)
	}
	summary.RunID = runID
	finish := func(runErr error) (RunSummary, error) {
		summary.FinishedAt = time.Now().UTC()
		if runErr != nil {
			summary.Status = RunStatusFailed
			summary.Error = runErr.Error()
		} else {
			summary.Status = RunStatusCompleted
		}
		if err := r.store.CompleteRun(ctx, summary); err != nil && runErr == nil {
			return summary, fmt.Errorf("complete image reconciliation run: %w", err)
		}
		return summary, runErr
	}

	staleJobs, err := r.store.FindStaleJobs(ctx, now.Add(-r.options.StaleAfter), r.options.JobLimit)
	if err != nil {
		return finish(fmt.Errorf("find stale image jobs: %w", err))
	}
	for _, job := range staleJobs {
		summary.StaleJobs++
		if err := r.store.RecordFinding(ctx, Finding{
			RunID: runID,
			Kind:  FindingKindStaleJob, Subject: job.ID, Status: job.Status,
			Detail: "job exceeded reconciliation age threshold", CreatedAt: now,
		}); err != nil {
			return finish(fmt.Errorf("record stale image job %q: %w", job.ID, err))
		}
	}

	referenced, err := r.store.ListReferencedObjectPaths(ctx)
	if err != nil {
		return finish(fmt.Errorf("list referenced image objects: %w", err))
	}
	references := make(map[string]struct{}, len(referenced))
	for _, path := range referenced {
		if path = strings.TrimSpace(path); path != "" {
			references[path] = struct{}{}
		}
	}
	objects, err := r.storage.ListObjects(ctx, "")
	if err != nil {
		return finish(fmt.Errorf("list image storage objects: %w", err))
	}
	for _, object := range objects {
		if !isManagedImageObject(object.Path) || object.LastModified.IsZero() || object.LastModified.After(now.Add(-r.options.OrphanGrace)) {
			continue
		}
		if _, ok := references[object.Path]; ok {
			continue
		}
		summary.OrphanObjects++
		if err := r.store.RecordFinding(ctx, Finding{
			RunID: runID,
			Kind:  FindingKindOrphanObject, Subject: object.Path,
			Detail: "object is outside the grace period and has no job/history reference", CreatedAt: now,
		}); err != nil {
			return finish(fmt.Errorf("record orphan image object %q: %w", object.Path, err))
		}
		if err := r.storage.DeleteObjects(ctx, object.Path); err != nil {
			return finish(fmt.Errorf("delete orphan image object %q: %w", object.Path, err))
		}
		summary.DeletedObjects++
	}
	return finish(nil)
}

func isManagedImageObject(path string) bool {
	return strings.HasPrefix(path, "generated/") || strings.HasPrefix(path, "staging/image-jobs/")
}
