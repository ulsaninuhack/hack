import type { DataBundle } from './types'

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`${path} 데이터를 불러오지 못했습니다.`)
  return response.json() as Promise<T>
}

export async function loadData(): Promise<DataBundle> {
  const [dongs, facilities, transit, summary] = await Promise.all([
    fetchJson<DataBundle['dongs']>('/data/admin-dongs.geojson'),
    fetchJson<DataBundle['facilities']>('/data/facilities.geojson'),
    fetchJson<DataBundle['transit']>('/data/transit-stops.geojson'),
    fetchJson<DataBundle['summary']>('/data/summary.json'),
  ])
  return { dongs, facilities, transit, summary }
}
