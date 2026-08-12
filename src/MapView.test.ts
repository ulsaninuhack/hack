import { describe, expect, it } from 'vitest'
import { hasOperationalMapLayers } from './MapView'

const sourceIds = ['admin-dongs', 'dong-bubbles', 'facilities', 'transit', 'synthetic-contact-case']
const layerIds = ['dong-fill', 'dong-border', 'dong-bubbles', 'facility-clusters', 'facility-cluster-count', 'facility-points', 'transit-points', 'synthetic-contact-case-halo', 'synthetic-contact-case-point']

describe('MapView readiness contract', () => {
  it('requires every interactive GeoJSON source and layer before the first render can mark the map ready', () => {
    const readyMap = {
      getSource: (id: string) => sourceIds.includes(id) ? {} : undefined,
      getLayer: (id: string) => layerIds.includes(id) ? {} : undefined,
    }
    expect(hasOperationalMapLayers(readyMap)).toBe(true)
    expect(hasOperationalMapLayers({ ...readyMap, getLayer: (id: string) => id === 'transit-points' ? undefined : readyMap.getLayer(id) })).toBe(false)
  })
})
