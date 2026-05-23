import { NVIDIA_RPM } from '../config.js'

export class RateLimiter {
  private maxRequests: number
  private windowMs: number
  private timestamps: number[]

  constructor(maxRequests: number = NVIDIA_RPM, windowMs: number = 60_000) {
    this.maxRequests = maxRequests
    this.windowMs = windowMs
    this.timestamps = []
  }

  acquire(): { ok: boolean; waitMs: number } {
    const now = Date.now()
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs)
    if (this.timestamps.length < this.maxRequests) {
      this.timestamps.push(now)
      return { ok: true, waitMs: 0 }
    }
    return { ok: false, waitMs: this.timestamps[0] + this.windowMs - now + 50 }
  }

  penalize(): void {
    this.timestamps = Array(this.maxRequests).fill(Date.now())
  }
}
