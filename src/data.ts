import type { DataBundle } from './types'

const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL)
const ZONE_LIMIT = 200
const LIST_LIMIT = 500
const MAX_PAGES = 1_000

interface ApiEnvelope<T> {
  data: T
}

interface PaginatedApiEnvelope<T> extends ApiEnvelope<T> {
  meta?: {
    pagination?: {
      total?: number
      returned?: number
      hasMore?: boolean
      offset?: number
      limit?: number
    }
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`${path} 데이터를 불러오지 못했습니다.`)
  return response.json() as Promise<T>
}

function normalizeBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed.replace(/\/+$/, '') : null
}

function apiUrl(path: string, params?: Record<string, string | number>): string {
  if (!API_BASE_URL) throw new Error('API base URL is not configured.')
  const url = new URL(path, `${API_BASE_URL}/`)
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

async function fetchApiJson<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = apiUrl(path, params)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} 데이터를 불러오지 못했습니다.`)
  return response.json() as Promise<T>
}

async function fetchApiData<T>(path: string): Promise<T> {
  const body = await fetchApiJson<ApiEnvelope<T>>(path)
  return body.data
}

async function fetchAllApiFeatures<TCollection extends { type: 'FeatureCollection'; features: unknown[] }>(
  path: string,
  limit: number,
): Promise<TCollection> {
  let offset = 0
  let pageCount = 0
  let firstPage: TCollection | null = null
  const features: TCollection['features'] = []

  while (pageCount < MAX_PAGES) {
    const body = await fetchApiJson<PaginatedApiEnvelope<TCollection>>(path, { limit, offset })
    firstPage ??= body.data
    features.push(...body.data.features)

    const pagination = body.meta?.pagination
    if (!pagination?.hasMore) break
    if (typeof pagination.total === 'number' && features.length >= pagination.total) break

    const pageOffset = typeof pagination.offset === 'number' ? pagination.offset : offset
    const nextOffset = pageOffset + limit
    if (nextOffset <= offset) throw new Error(`${path} 페이지네이션이 진행되지 않았습니다.`)
    offset = nextOffset
    pageCount += 1
  }

  if (pageCount >= MAX_PAGES) throw new Error(`${path} 페이지네이션 한도를 초과했습니다.`)
  if (!firstPage) throw new Error(`${path} 데이터가 비어 있습니다.`)

  return { ...firstPage, features } as TCollection
}

async function loadStaticData(runtimeSource: DataBundle['runtimeSource'] = 'static'): Promise<DataBundle> {
  const [dongs, facilities, transit, summary] = await Promise.all([
    fetchJson<DataBundle['dongs']>('/data/admin-dongs.geojson'),
    fetchJson<DataBundle['facilities']>('/data/facilities.geojson'),
    fetchJson<DataBundle['transit']>('/data/transit-stops.geojson'),
    fetchJson<DataBundle['summary']>('/data/summary.json'),
  ])
  return { dongs, facilities, transit, summary, runtimeSource }
}

async function loadApiData(): Promise<DataBundle> {
  const [dongs, facilities, transit, summary] = await Promise.all([
    fetchAllApiFeatures<DataBundle['dongs']>('/api/v1/zones', ZONE_LIMIT),
    fetchAllApiFeatures<DataBundle['facilities']>('/api/v1/facilities', LIST_LIMIT),
    fetchAllApiFeatures<DataBundle['transit']>('/api/v1/transit', LIST_LIMIT),
    fetchApiData<DataBundle['summary']>('/api/v1/summary'),
  ])
  return { dongs, facilities, transit, summary, runtimeSource: 'api' }
}

export async function loadData(): Promise<DataBundle> {
  if (!API_BASE_URL) return loadStaticData()

  try {
    return await loadApiData()
  } catch (error) {
    console.warn('API 데이터 로딩 실패, 검증된 정적 데이터로 fallback합니다.', error)
    return loadStaticData('static-fallback')
  }
}
