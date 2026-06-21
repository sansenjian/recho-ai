import { describe, expect, it } from 'vitest'
import {
  firstImageID,
  imageAttemptErrorType,
  parseImageAttemptResponseJSON,
  responseErrorMessage,
  shouldBufferImageAttemptBody,
} from '../backend/gateway/src/services/go-sidecar-image-attempt'

describe('go sidecar image attempt helpers', () => {
  it('classifies proxied image generation failures by HTTP status', () => {
    expect(imageAttemptErrorType(504)).toBe('timeout')
    expect(imageAttemptErrorType(429)).toBe('rate_limit')
    expect(imageAttemptErrorType(403)).toBe('auth')
    expect(imageAttemptErrorType(402)).toBe('credits')
    expect(imageAttemptErrorType(503)).toBe('provider')
    expect(imageAttemptErrorType(400)).toBe('request')
  })

  it('extracts the first returned image id from Go image responses', () => {
    expect(firstImageID({ images: [{ id: 'img_1' }, { id: 'img_2' }] })).toBe('img_1')
    expect(firstImageID({ images: [{ id: '' }] })).toBeNull()
    expect(firstImageID({ images: [] })).toBeNull()
    expect(firstImageID({ data: [{ id: 'wrong_shape' }] })).toBeNull()
  })

  it('parses JSON response bodies safely', () => {
    expect(parseImageAttemptResponseJSON(Buffer.from('{"images":[{"id":"img_1"}]}'))).toEqual({
      images: [{ id: 'img_1' }],
    })
    expect(parseImageAttemptResponseJSON(Buffer.from('not json'))).toBeNull()
  })

  it('only buffers clearly small JSON image responses', () => {
    expect(shouldBufferImageAttemptBody('application/json', '1024')).toBe(true)
    expect(shouldBufferImageAttemptBody('application/problem+json; charset=utf-8', '1024')).toBe(true)
    expect(shouldBufferImageAttemptBody('application/json', String(1024 * 1024 + 1))).toBe(false)
    expect(shouldBufferImageAttemptBody('application/json', null)).toBe(false)
    expect(shouldBufferImageAttemptBody('image/png', '1024')).toBe(false)
    expect(shouldBufferImageAttemptBody('application/json', 'not-a-number')).toBe(false)
  })

  it('extracts useful error messages from failed Go responses', () => {
    expect(responseErrorMessage({ error: '额度不足。' }, Buffer.from(''))).toBe('额度不足。')
    expect(responseErrorMessage({ message: 'provider failed' }, Buffer.from(''))).toBe('provider failed')
    expect(responseErrorMessage({ error: { code: 'bad_request' }, message: 'top-level provider message' }, Buffer.from('')))
      .toBe('top-level provider message')
    expect(responseErrorMessage({ error: { message: 'nested provider failure' } }, Buffer.from(''))).toBe('nested provider failure')
    expect(responseErrorMessage(null, Buffer.from('plain upstream failure'))).toBe('plain upstream failure')
    expect(responseErrorMessage(null, Buffer.from(''))).toBe('Go image generation failed')
  })
})
