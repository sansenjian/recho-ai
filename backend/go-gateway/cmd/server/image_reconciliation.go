package main

import (
	"context"
	"log"
	"time"

	"go-gateway/internal/reconciliation"
	"go-gateway/internal/service"
)

type imageReconciliationStorageAdapter struct {
	storage *service.StorageService
}

func (a imageReconciliationStorageAdapter) ListObjects(ctx context.Context, prefix string) ([]reconciliation.ObjectInfo, error) {
	objects, err := a.storage.ListObjects(ctx, prefix)
	if err != nil {
		return nil, err
	}
	result := make([]reconciliation.ObjectInfo, 0, len(objects))
	for _, object := range objects {
		result = append(result, reconciliation.ObjectInfo{
			Path: object.Path, LastModified: object.LastModified,
		})
	}
	return result, nil
}

func (a imageReconciliationStorageAdapter) DeleteObjects(ctx context.Context, paths ...string) error {
	return a.storage.DeleteObjects(ctx, paths...)
}

type imageReconcilerRunner interface {
	Run(context.Context, time.Time) (reconciliation.RunSummary, error)
}

func runImageReconciliationLoop(ctx context.Context, reconciler imageReconcilerRunner, interval time.Duration, logger *log.Logger) {
	if interval <= 0 {
		interval = 15 * time.Minute
	}
	if logger == nil {
		logger = log.Default()
	}
	run := func() {
		report, err := reconciler.Run(ctx, time.Now().UTC())
		if err != nil {
			if ctx.Err() == nil {
				logger.Printf("[image-reconciliation] run failed: %v", err)
			}
			return
		}
		logger.Printf(
			"[image-reconciliation] run completed run_id=%s stale_jobs=%d orphan_objects=%d deleted_objects=%d",
			report.RunID, report.StaleJobs, report.OrphanObjects, report.DeletedObjects,
		)
	}
	run()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}
