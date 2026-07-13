import { describe, expect, it } from 'vitest'
import {
  loadGoOwnedContract,
  materializeContractPath,
  validateGoOwnedContract,
} from './helpers/go-owned-contract'

function validContract() {
  return {
    version: 1,
    requestIdHeader: 'X-Request-ID',
    forwardHeaders: ['Authorization', 'X-Request-ID'],
    errorStatuses: [400, 500],
    routes: [{
      id: 'config-app',
      method: 'GET',
      path: '/api/config/app',
      requestKind: 'none',
      headers: [],
      successStatuses: [200],
    }],
    liveScenarios: [{
      id: 'config-app',
      method: 'GET',
      path: '/api/config/app',
      expectedStatus: 200,
      requiredJsonKeys: ['guestGenerationEnabled'],
    }],
  }
}

describe('go-owned API contract', () => {
  it('loads the shared route surface', async () => {
    const contract = await loadGoOwnedContract()

    expect(contract.version).toBe(1)
    expect(contract.requestIdHeader).toBe('X-Request-ID')
    expect(new Set(contract.routes.map(route => route.id)).size).toBe(contract.routes.length)
    expect(contract.routes).toContainEqual(expect.objectContaining({
      method: 'POST',
      path: '/api/image/generate',
      requestKind: 'json',
      headers: expect.arrayContaining(['Idempotency-Key']),
    }))
    expect(contract.liveScenarios.map(scenario => scenario.id)).toEqual([
      'config-app',
      'config-supabase',
      'credits-unauthorized',
      'image-generate-storage-unavailable',
    ])
  })

  it('materializes chi path parameters for HTTP requests', () => {
    expect(materializeContractPath('/api/image/history/{id}')).toBe('/api/image/history/contract-id')
    expect(materializeContractPath('/api/image/storage/*')).toBe('/api/image/storage/contract/object.png')
  })

  it('rejects duplicate route ids and method/path pairs', () => {
    const duplicateId = validContract()
    duplicateId.routes.push({
      ...duplicateId.routes[0],
      path: '/api/config/supabase',
    })
    expect(() => validateGoOwnedContract(duplicateId)).toThrow(/duplicate route id: config-app/i)

    const duplicatePair = validContract()
    duplicatePair.routes.push({
      ...duplicatePair.routes[0],
      id: 'config-app-copy',
    })
    expect(() => validateGoOwnedContract(duplicatePair)).toThrow(/duplicate route: GET \/api\/config\/app/i)
  })

  it('rejects invalid paths and request kinds', () => {
    const invalidPath = validContract()
    invalidPath.routes[0].path = '/health'
    expect(() => validateGoOwnedContract(invalidPath)).toThrow(/routes\[0\]\.path/i)

    const invalidKind = validContract()
    invalidKind.routes[0].requestKind = 'multipart'
    expect(() => validateGoOwnedContract(invalidKind)).toThrow(/routes\[0\]\.requestKind/i)
  })
})
