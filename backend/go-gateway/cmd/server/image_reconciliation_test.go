package main

import (
	"context"
	"io"
	"log"
	"testing"
	"time"

	"go-gateway/internal/reconciliation"
)

type testImageReconcilerRunner struct {
	runs chan struct{}
}

func (r *testImageReconcilerRunner) Run(context.Context, time.Time) (reconciliation.RunSummary, error) {
	r.runs <- struct{}{}
	return reconciliation.RunSummary{RunID: "run-test"}, nil
}

func TestRunImageReconciliationLoopRunsImmediatelyAndStopsOnCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runner := &testImageReconcilerRunner{runs: make(chan struct{}, 1)}
	done := make(chan struct{})
	go func() {
		defer close(done)
		runImageReconciliationLoop(ctx, runner, time.Hour, log.New(io.Discard, "", 0))
	}()

	select {
	case <-runner.runs:
	case <-time.After(time.Second):
		t.Fatal("reconciliation loop did not run immediately")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("reconciliation loop did not stop after cancellation")
	}
}
