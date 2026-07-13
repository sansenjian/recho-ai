import type { ErrorRequestHandler } from 'express'
import { apiErrorBody } from '../services/api-error.js'

type BodyParserError = Error & {
  type?: string
}

export const requestBodyErrorMiddleware: ErrorRequestHandler = (error, req, res, next) => {
  const bodyError = error as BodyParserError

  if (bodyError.type === 'entity.parse.failed') {
    console.warn('[gateway] request body parse failed')
    res.status(400).json(apiErrorBody(req, 'INVALID_REQUEST_BODY', '请求体解析失败，请检查输入是否为合法 JSON。'))
    return
  }

  if (bodyError.type === 'entity.too.large') {
    console.warn('[gateway] request body too large')
    res.status(413).json(apiErrorBody(req, 'REQUEST_BODY_TOO_LARGE', '请求体过大，请减少参考图数量或压缩图片后重试。'))
    return
  }

  next(error)
}
