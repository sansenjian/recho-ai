// Package saga 提供一个轻量的 Saga 执行器，用于显式建模多步业务编排。
//
// 每个 Step 携带一个 Do（正向执行）和一个可选的 Compensate（反向补偿）。
// Runner 顺序执行所有步骤；当某一步的 Do 失败时，Runner 会反向遍历
// 已成功完成的步骤并调用其 Compensate，从而把系统恢复到一致状态。
//
// 设计目标：
//   - 把散落在 handler 里的多点回滚逻辑收敛到一处，降低漏写回滚的风险
//   - 新增步骤时强制声明 Compensate，避免遗忘清理动作
//   - 不依赖任何外部框架，可独立单测
package saga

import (
	"context"
	"errors"
	"fmt"
	"log"
)

// Step 表示 Saga 中的一个执行步骤。
//
// Do 是正向动作，返回 error 表示失败。
// Compensate 是反向补偿动作，在 Do 成功后、后续步骤失败时被调用。
// Compensate 可为 nil，表示该步骤不可逆（如调用外部 API 生成图片），
// 此时 Runner 跳过补偿并记录告警。
//
// Name 仅用于日志与错误归因，不参与执行控制流。
type Step struct {
	Name       string
	Do         func(ctx context.Context) error
	Compensate func(ctx context.Context) error
}

// Runner 顺序执行步骤，失败时反向补偿已成功的步骤。
//
// 零值不可用，必须通过 NewRunner 构造。
type Runner struct {
	logger *log.Logger
	steps  []Step
}

// NewRunner 创建一个空的 Runner。logger 为 nil 时使用标准 logger。
func NewRunner(logger *log.Logger) *Runner {
	if logger == nil {
		logger = log.Default()
	}
	return &Runner{logger: logger}
}

// Add 追加一个步骤。返回 Runner 自身以支持链式调用。
func (r *Runner) Add(step Step) *Runner {
	r.steps = append(r.steps, step)
	return r
}

// Run 执行所有步骤。
//
// 成功：所有步骤的 Do 均返回 nil。
// 失败：返回触发失败的步骤错误；同时已成功步骤会被反向补偿。
//       补偿动作本身的错误不会中断后续补偿，只会被记录到日志，
//       避免一个补偿失败导致其余补偿被跳过。
//       最终返回的错误是原始的 Do 错误（用 ErrStepFailed 包装），
//       补偿失败可通过 ErrCompensationFailed 获取（若有）。
func (r *Runner) Run(ctx context.Context) error {
	completed := make([]int, 0, len(r.steps))

	for i, step := range r.steps {
		if step.Do == nil {
			continue
		}
		if err := step.Do(ctx); err != nil {
			r.logger.Printf("[saga] step %q failed: %v — compensating %d completed step(s)", step.Name, err, len(completed))
			compErr := r.compensate(ctx, completed)
			if compErr != nil {
				// Go 1.20+ 支持多个 %w，使 errors.Is 可同时识别两层错误。
				return fmt.Errorf("%w: %v (compensation also failed: %w)", ErrStepFailed, err, compErr)
			}
			return fmt.Errorf("%w: %v", ErrStepFailed, err)
		}
		completed = append(completed, i)
	}
	return nil
}

// compensate 反向遍历已完成的步骤索引并调用对应的 Compensate。
func (r *Runner) compensate(ctx context.Context, completed []int) error {
	var firstCompErr error
	for i := len(completed) - 1; i >= 0; i-- {
		idx := completed[i]
		step := r.steps[idx]
		if step.Compensate == nil {
			r.logger.Printf("[saga] step %q has no compensate — skipping", step.Name)
			continue
		}
		if err := step.Compensate(ctx); err != nil {
			r.logger.Printf("[saga] step %q compensation failed: %v", step.Name, err)
			if firstCompErr == nil {
				firstCompErr = fmt.Errorf("%w: step %q: %v", ErrCompensationFailed, step.Name, err)
			}
			// 继续尝试其余补偿，不中断
		}
	}
	return firstCompErr
}

// ErrStepFailed 表示某个正向步骤执行失败（已触发补偿）。
var ErrStepFailed = errors.New("saga step failed")

// ErrCompensationFailed 表示补偿动作本身失败。
var ErrCompensationFailed = errors.New("saga compensation failed")
