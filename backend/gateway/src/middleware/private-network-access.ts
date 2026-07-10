import type { RequestHandler } from 'express'

const PRIVATE_NETWORK_REQUEST_HEADER = 'access-control-request-private-network'
const PRIVATE_NETWORK_RESPONSE_HEADER = 'Access-Control-Allow-Private-Network'

export const privateNetworkAccessMiddleware: RequestHandler = (req, res, next) => {
  if (
    req.method === 'OPTIONS' &&
    req.headers[PRIVATE_NETWORK_REQUEST_HEADER] === 'true'
  ) {
    res.setHeader(PRIVATE_NETWORK_RESPONSE_HEADER, 'true')
    res.vary('Access-Control-Request-Private-Network')
  }

  next()
}
