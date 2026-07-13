package reconciliation

import (
	"context"
	"testing"
	"time"
)

type fakeReconciliationStore struct {
	staleJobs  []StaleImageJob
	references []string
	findings   []Finding
	completed  *RunSummary
}

func (s *fakeReconciliationStore) BeginRun(context.Context, time.Time) (string, error) {
	return "run-1", nil
}

func (s *fakeReconciliationStore) FindStaleJobs(context.Context, time.Time, int) ([]StaleImageJob, error) {
	return append([]StaleImageJob(nil), s.staleJobs...), nil
}

func (s *fakeReconciliationStore) ListReferencedObjectPaths(context.Context) ([]string, error) {
	return append([]string(nil), s.references...), nil
}

func (s *fakeReconciliationStore) RecordFinding(_ context.Context, finding Finding) error {
	s.findings = append(s.findings, finding)
	return nil
}

func (s *fakeReconciliationStore) CompleteRun(_ context.Context, summary RunSummary) error {
	copy := summary
	s.completed = &copy
	return nil
}

type fakeReconciliationStorage struct {
	objects []ObjectInfo
	deleted []string
}

func (s *fakeReconciliationStorage) ListObjects(context.Context, string) ([]ObjectInfo, error) {
	return append([]ObjectInfo(nil), s.objects...), nil
}

func (s *fakeReconciliationStorage) DeleteObjects(_ context.Context, paths ...string) error {
	s.deleted = append(s.deleted, paths...)
	return nil
}

func TestImageReconcilerAuditsStaleJobsAndDeletesOnlyOldUnreferencedObjects(t *testing.T) {
	now := time.Date(2026, 7, 12, 16, 0, 0, 0, time.UTC)
	store := &fakeReconciliationStore{
		staleJobs: []StaleImageJob{{ID: "job-stale", Status: "refund_pending", UpdatedAt: now.Add(-2 * time.Hour)}},
		references: []string{
			"generated/referenced.png",
			"staging/image-jobs/active/source.png",
		},
	}
	storage := &fakeReconciliationStorage{objects: []ObjectInfo{
		{Path: "generated/referenced.png", LastModified: now.Add(-48 * time.Hour)},
		{Path: "generated/orphan.png", LastModified: now.Add(-48 * time.Hour)},
		{Path: "generated/recent.png", LastModified: now.Add(-10 * time.Minute)},
		{Path: "unmanaged/keep.txt", LastModified: now.Add(-48 * time.Hour)},
	}}

	reconciler := NewImageReconciler(store, storage, Options{
		StaleAfter:  time.Hour,
		OrphanGrace: 24 * time.Hour,
		JobLimit:    100,
	})
	report, err := reconciler.Run(context.Background(), now)
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if len(storage.deleted) != 1 || storage.deleted[0] != "generated/orphan.png" {
		t.Fatalf("deleted objects = %#v, want only old generated orphan", storage.deleted)
	}
	if report.StaleJobs != 1 || report.OrphanObjects != 1 || report.DeletedObjects != 1 {
		t.Fatalf("report = %#v", report)
	}
	if store.completed == nil || store.completed.Status != RunStatusCompleted {
		t.Fatalf("completed run = %#v", store.completed)
	}
	if !hasFinding(store.findings, FindingKindStaleJob, "job-stale") {
		t.Fatalf("missing stale job finding: %#v", store.findings)
	}
	if !hasFinding(store.findings, FindingKindOrphanObject, "generated/orphan.png") {
		t.Fatalf("missing orphan finding: %#v", store.findings)
	}
}

func hasFinding(findings []Finding, kind, subject string) bool {
	for _, finding := range findings {
		if finding.Kind == kind && finding.Subject == subject {
			return true
		}
	}
	return false
}
