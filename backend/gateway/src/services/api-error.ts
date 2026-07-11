import type { Request } from 'express'
import { requestId } from '../middleware/request-observability.js'

export type GatewayErrorCode =
  | 'GATEWAY_TIMEOUT'
  | 'GO_SIDECAR_UNAVAILABLE'
  | 'GO_SIDECAR_TIMEOUT'
  | 'INVALID_REQUEST_BODY'
  | 'REQUEST_BODY_TOO_LARGE'
  | 'INTERNAL_ERROR'

export function apiErrorBody(req: Request, code: GatewayErrorCode, error: string) {
  return {
    error,
    code,
    requestId: requestId(req),
  }
}
