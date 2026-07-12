import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export type ContractRequestKind = 'none' | 'json' | 'binary'

export type GoOwnedContractRoute = {
  id: string
  method: string
  path: string
  requestKind: ContractRequestKind
  headers: string[]
  successStatuses: number[]
}

export type GoOwnedContractScenario = {
  id: string
  method: string
  path: string
  expectedStatus: number
  requiredJsonKeys: string[]
  expectedCode?: string
}

export type GoOwnedContract = {
  version: 1
  requestIdHeader: string
  forwardHeaders: string[]
  errorStatuses: number[]
  routes: GoOwnedContractRoute[]
  liveScenarios: GoOwnedContractScenario[]
}

const contractPath = resolve(process.cwd(), 'contracts/go-owned-api.json')
const requestKinds = new Set<ContractRequestKind>(['none', 'json', 'binary'])

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${field} must be a non-empty string`)
  return value
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item)) {
    throw new Error(`${field} must be an array of non-empty strings`)
  }
  return [...value]
}

function statusArray(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => !Number.isInteger(item) || item < 100 || item > 599)) {
    throw new Error(`${field} must contain HTTP status integers`)
  }
  return [...value]
}

function validateRoute(value: unknown, index: number, forwarded: Set<string>): GoOwnedContractRoute {
  const route = record(value, `routes[${index}]`)
  const path = stringValue(route.path, `routes[${index}].path`)
  if (!path.startsWith('/api/')) throw new Error(`routes[${index}].path must start with /api/`)

  const requestKind = stringValue(route.requestKind, `routes[${index}].requestKind`)
  if (!requestKinds.has(requestKind as ContractRequestKind)) {
    throw new Error(`routes[${index}].requestKind is invalid: ${requestKind}`)
  }
  const headers = stringArray(route.headers, `routes[${index}].headers`)
  for (const header of headers) {
    if (!forwarded.has(header)) throw new Error(`routes[${index}].headers contains undeclared header: ${header}`)
  }

  return {
    id: stringValue(route.id, `routes[${index}].id`),
    method: stringValue(route.method, `routes[${index}].method`).toUpperCase(),
    path,
    requestKind: requestKind as ContractRequestKind,
    headers,
    successStatuses: statusArray(route.successStatuses, `routes[${index}].successStatuses`),
  }
}

function validateScenario(value: unknown, index: number): GoOwnedContractScenario {
  const scenario = record(value, `liveScenarios[${index}]`)
  const path = stringValue(scenario.path, `liveScenarios[${index}].path`)
  if (!path.startsWith('/api/')) throw new Error(`liveScenarios[${index}].path must start with /api/`)
  const expectedStatus = scenario.expectedStatus
  if (!Number.isInteger(expectedStatus) || Number(expectedStatus) < 100 || Number(expectedStatus) > 599) {
    throw new Error(`liveScenarios[${index}].expectedStatus must be an HTTP status integer`)
  }
  const expectedCode = scenario.expectedCode
  if (expectedCode !== undefined && (typeof expectedCode !== 'string' || !expectedCode)) {
    throw new Error(`liveScenarios[${index}].expectedCode must be a non-empty string`)
  }
  return {
    id: stringValue(scenario.id, `liveScenarios[${index}].id`),
    method: stringValue(scenario.method, `liveScenarios[${index}].method`).toUpperCase(),
    path,
    expectedStatus: Number(expectedStatus),
    requiredJsonKeys: stringArray(scenario.requiredJsonKeys, `liveScenarios[${index}].requiredJsonKeys`),
    ...(expectedCode === undefined ? {} : { expectedCode }),
  }
}

export function validateGoOwnedContract(value: unknown): GoOwnedContract {
  const contract = record(value, 'contract')
  if (contract.version !== 1) throw new Error('version must be 1')
  const forwardHeaders = stringArray(contract.forwardHeaders, 'forwardHeaders')
  const forwarded = new Set(forwardHeaders)
  const rawRoutes = contract.routes
  const rawScenarios = contract.liveScenarios
  if (!Array.isArray(rawRoutes) || rawRoutes.length === 0) throw new Error('routes must be a non-empty array')
  if (!Array.isArray(rawScenarios) || rawScenarios.length === 0) throw new Error('liveScenarios must be a non-empty array')

  const routes = rawRoutes.map((route, index) => validateRoute(route, index, forwarded))
  const ids = new Set<string>()
  const pairs = new Set<string>()
  for (const route of routes) {
    if (ids.has(route.id)) throw new Error(`duplicate route id: ${route.id}`)
    ids.add(route.id)
    const pair = `${route.method} ${route.path}`
    if (pairs.has(pair)) throw new Error(`duplicate route: ${pair}`)
    pairs.add(pair)
  }

  return {
    version: 1,
    requestIdHeader: stringValue(contract.requestIdHeader, 'requestIdHeader'),
    forwardHeaders,
    errorStatuses: statusArray(contract.errorStatuses, 'errorStatuses'),
    routes,
    liveScenarios: rawScenarios.map(validateScenario),
  }
}

export async function loadGoOwnedContract(): Promise<GoOwnedContract> {
  return validateGoOwnedContract(JSON.parse(await readFile(contractPath, 'utf8')))
}

export function materializeContractPath(path: string): string {
  return path.replace(/\{[^}]+\}/g, 'contract-id').replace('*', 'contract/object.png')
}
