import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { ExpressionSpecification, Map, MapMouseEvent } from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
import type { DataBundle, DongProperties, MetricKey } from './types'

interface MapViewProps {
  data: DataBundle
  metric: MetricKey
  showFacilities: boolean
  showTransit: boolean
  facilityCategory: string
  selectedZoneId: string | null
  onSelectDong: (properties: DongProperties) => void
  syntheticPoint?: { caseId: string; longitude: number; latitude: number } | null
  mapMode?: 'public' | 'operations'
  operationsByZone?: Record<string, { acute_color_metric: number | null; vulnerability_size_metric: number | null }>
  ariaLabel?: string
}

const DONG_SOURCE = 'admin-dongs'
const BUBBLE_SOURCE = 'dong-bubbles'
const FACILITY_SOURCE = 'facilities'
const TRANSIT_SOURCE = 'transit'
const SYNTHETIC_POINT_SOURCE = 'synthetic-contact-case'
const OPERATIONAL_SOURCES = [DONG_SOURCE, BUBBLE_SOURCE, FACILITY_SOURCE, TRANSIT_SOURCE, SYNTHETIC_POINT_SOURCE]
const OPERATIONAL_LAYERS = ['dong-fill', 'dong-border', 'dong-bubbles', 'facility-clusters', 'facility-cluster-count', 'facility-points', 'transit-points', 'synthetic-contact-case-halo', 'synthetic-contact-case-point']

// MapLibre 6 resolves its worker next to the bundled entry at runtime. Vite
// cannot discover that computed URL, so the build emits the worker and shared
// module explicitly from vite.config.ts.
if (import.meta.env.PROD) maplibregl.setWorkerUrl('/assets/maplibre-gl-worker.mjs')

function colorExpression(metric: MetricKey): ExpressionSpecification {
  if (metric === 'one_person_households_age_65_plus') {
    return ['interpolate', ['linear'], ['get', metric], 0, '#eef7e1', 600, '#a9d18a', 1000, '#f4d35e', 1500, '#ee9b3a', 2500, '#c1443c']
  }
  if (metric === 'housing_age_30_plus_share_valid_pct') {
    return [
      'case',
      ['==', ['get', metric], null],
      '#aeb5b2',
      ['interpolate', ['linear'], ['get', metric], 0, '#f6f1e7', 35, '#f2d39b', 55, '#df9d67', 75, '#b95e4c', 95, '#702e3f'],
    ]
  }
  return ['interpolate', ['linear'], ['get', metric], 0.12, '#eef7e1', 0.24, '#a9d18a', 0.3, '#f4d35e', 0.36, '#ee9b3a', 0.48, '#c1443c']
}

function mapColorExpression(mode: MapViewProps['mapMode'], metric: MetricKey): ExpressionSpecification {
  if (mode === 'operations') return ['case', ['==', ['feature-state', 'acute'], null], '#d8dedb', ['interpolate', ['linear'], ['feature-state', 'acute'], 0, '#f6f0df', 25, '#edbb67', 50, '#db7049', 75, '#8f2f3c', 100, '#4d1830']]
  return colorExpression(metric)
}

function setVisibility(map: Map, layer: string, visible: boolean) {
  if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none')
}

export default function MapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const latestRef = useRef(props)
  latestRef.current = props

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          base: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'base', type: 'raster', source: 'base', paint: { 'raster-saturation': -0.75, 'raster-opacity': 0.6 } }],
      },
      center: [126.56, 37.47],
      zoom: 9.15,
      minZoom: 7,
      maxZoom: 17,
      maxBounds: [[123.8, 36.5], [127.4, 38.35]],
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left')
    map.on('error', (event) => console.error('MapLibre render error', event.error))

    map.on('load', () => {
      const current = latestRef.current
      map.addSource(DONG_SOURCE, { type: 'geojson', data: current.data.dongs, promoteId: 'geometry_zone_id' })
      map.addLayer({
        id: 'dong-fill', type: 'fill', source: DONG_SOURCE,
        paint: { 'fill-color': mapColorExpression(current.mapMode, current.metric), 'fill-opacity': 0.76 },
      })
      map.addLayer({
        id: 'dong-border', type: 'line', source: DONG_SOURCE,
        paint: { 'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#f7c765', '#ffffff'], 'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 0.8], 'line-opacity': 0.9 },
      })
      map.addSource(BUBBLE_SOURCE, { type: 'geojson', data: toBubbleCollection(current.data, current.operationsByZone) })
      map.addLayer({
        id: 'dong-bubbles', type: 'circle', source: BUBBLE_SOURCE,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, ['interpolate', ['linear'], ['get', 'vulnerability'], 0, 2, 100, 14], 13, ['interpolate', ['linear'], ['get', 'vulnerability'], 0, 5, 100, 25]],
          'circle-color': ['case', ['==', ['get', 'acute'], null], '#f3bd54', ['interpolate', ['linear'], ['get', 'acute'], 0, '#f6f0df', 50, '#db7049', 100, '#4d1830']], 'circle-opacity': 0.82, 'circle-stroke-color': '#5d4213', 'circle-stroke-width': 1,
        },
      })
      map.addSource(FACILITY_SOURCE, { type: 'geojson', data: current.data.facilities, cluster: true, clusterMaxZoom: 13, clusterRadius: 48 })
      map.addLayer({
        id: 'facility-clusters', type: 'circle', source: FACILITY_SOURCE, filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#f8fbf9',
          'circle-opacity': 0.97,
          'circle-radius': ['step', ['get', 'point_count'], 13, 20, 18, 100, 25],
          'circle-stroke-color': ['step', ['get', 'point_count'], '#37a899', 20, '#16796d', 100, '#0b4a44'],
          'circle-stroke-width': 3,
        },
      })
      map.addLayer({
        id: 'facility-cluster-count', type: 'symbol', source: FACILITY_SOURCE, filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 11 }, paint: { 'text-color': '#0b4a44' },
      })
      map.addLayer({
        id: 'facility-points', type: 'circle', source: FACILITY_SOURCE, filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': '#49a89a', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 14, 7], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
      })
      map.addSource(TRANSIT_SOURCE, { type: 'geojson', data: current.data.transit })
      map.addLayer({
        id: 'transit-points', type: 'circle', source: TRANSIT_SOURCE,
        paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'daily_average_board_alightings'], 0, 2, 500, 5, 4000, 10], 'circle-color': '#6279bd', 'circle-opacity': 0.6, 'circle-stroke-color': '#fff', 'circle-stroke-width': 0.5 },
      })
      map.addSource(SYNTHETIC_POINT_SOURCE, { type: 'geojson', data: toSyntheticPointCollection(current.syntheticPoint) })
      map.addLayer({
        id: 'synthetic-contact-case-halo', type: 'circle', source: SYNTHETIC_POINT_SOURCE,
        paint: { 'circle-radius': 16, 'circle-color': '#fff7df', 'circle-opacity': 0.9, 'circle-stroke-color': '#7a4d00', 'circle-stroke-width': 3 },
      })
      map.addLayer({
        id: 'synthetic-contact-case-point', type: 'circle', source: SYNTHETIC_POINT_SOURCE,
        paint: { 'circle-radius': 7, 'circle-color': '#f0ba50', 'circle-stroke-color': '#10211f', 'circle-stroke-width': 2 },
      })
      setVisibility(map, 'facility-clusters', current.showFacilities)
      setVisibility(map, 'facility-cluster-count', current.showFacilities)
      setVisibility(map, 'facility-points', current.showFacilities)
      setVisibility(map, 'transit-points', current.showTransit)
      setVisibility(map, 'dong-bubbles', current.mapMode === 'operations')
      updateContextStates(map, current)

      // `idle` waits for all network activity, including optional external raster
      // tiles and glyphs. Readiness instead means our interactive GeoJSON layers
      // are installed and have completed their first MapLibre render cycle.
      if (hasOperationalMapLayers(map)) {
        map.once('render', () => containerRef.current?.setAttribute('data-map-ready', 'true'))
        map.triggerRepaint()
      }

      const handleDong = (event: MapMouseEvent) => {
        const feature = map.queryRenderedFeatures(event.point, { layers: ['dong-fill'] })[0]
        if (feature?.properties) latestRef.current.onSelectDong(normalizeDongProperties(feature.properties))
      }
      map.on('click', 'dong-fill', handleDong)
      map.on('mouseenter', 'dong-fill', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'dong-fill', () => { map.getCanvas().style.cursor = '' })

      map.on('click', 'facility-clusters', async (event: MapMouseEvent) => {
        const cluster = map.queryRenderedFeatures(event.point, { layers: ['facility-clusters'] })[0]
        const id = Number(cluster?.properties?.cluster_id)
        const source = map.getSource(FACILITY_SOURCE) as maplibregl.GeoJSONSource
        const zoom = await source.getClusterExpansionZoom(id)
        const coordinates = (cluster.geometry as GeoJSON.Point).coordinates as [number, number]
        map.easeTo({ center: coordinates, zoom })
      })
      map.on('click', 'facility-points', (event: MapMouseEvent) => {
        const feature = map.queryRenderedFeatures(event.point, { layers: ['facility-points'] })[0]
        if (!feature) return
        const p = feature.properties as Record<string, string>
        const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number]
        new maplibregl.Popup({ offset: 10, maxWidth: '310px' }).setLngLat(coordinates).setHTML(
          `<div class="map-popup"><strong>${escapeHtml(p.facility_name)}</strong><span>${escapeHtml(p.category_major)} · ${escapeHtml(p.category_detail)}</span><p>${escapeHtml(p.official_address)}</p></div>`,
        ).addTo(map)
      })
      map.on('click', 'transit-points', (event: MapMouseEvent) => {
        const feature = map.queryRenderedFeatures(event.point, { layers: ['transit-points'] })[0]
        if (!feature) return
        const p = feature.properties as Record<string, string | number>
        const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number]
        new maplibregl.Popup({ offset: 8 }).setLngLat(coordinates).setHTML(
          `<div class="map-popup"><strong>${escapeHtml(String(p.stop_name))}</strong><span>노선 ${p.route_count ?? '자료 없음'}개</span><p>일평균 승하차 ${Number(p.daily_average_board_alightings).toLocaleString('ko-KR')}건</p></div>`,
        ).addTo(map)
      })
    })
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded() || !hasOperationalMapLayers(map)) return
    map.setPaintProperty('dong-fill', 'fill-color', mapColorExpression(props.mapMode, props.metric))
    updateContextStates(map, props)
    const bubbleSource = map.getSource(BUBBLE_SOURCE) as maplibregl.GeoJSONSource | undefined
    bubbleSource?.setData(toBubbleCollection(props.data, props.operationsByZone))
  }, [props.metric, props.mapMode, props.operationsByZone, props.data])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded() || !hasOperationalMapLayers(map)) return
    setVisibility(map, 'facility-clusters', props.showFacilities)
    setVisibility(map, 'facility-cluster-count', props.showFacilities)
    setVisibility(map, 'facility-points', props.showFacilities)
    setVisibility(map, 'transit-points', props.showTransit)
    setVisibility(map, 'dong-bubbles', props.mapMode === 'operations')
  }, [props.showFacilities, props.showTransit, props.mapMode])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded() || !map.getSource(FACILITY_SOURCE)) return
    const source = map.getSource(FACILITY_SOURCE) as maplibregl.GeoJSONSource | undefined
    if (!source) return
    const features = props.facilityCategory === '전체'
      ? props.data.facilities.features
      : props.data.facilities.features.filter((feature) => feature.properties.category_major === props.facilityCategory)
    source.setData({ type: 'FeatureCollection', features })
  }, [props.facilityCategory, props.data.facilities])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded() || !map.getSource(DONG_SOURCE)) return
    for (const feature of props.data.dongs.features) {
      const id = feature.properties.geometry_zone_id
      map.setFeatureState({ source: DONG_SOURCE, id }, { selected: id === props.selectedZoneId })
    }
    const selected = props.data.dongs.features.find((feature) => feature.properties.geometry_zone_id === props.selectedZoneId)
    if (selected) {
      map.easeTo({
        center: [selected.properties.representative_longitude, selected.properties.representative_latitude],
        zoom: Math.max(map.getZoom(), 11),
        duration: 650,
      })
    }
  }, [props.selectedZoneId, props.data.dongs.features])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded() || !map.getSource(SYNTHETIC_POINT_SOURCE)) return
    const source = map.getSource(SYNTHETIC_POINT_SOURCE) as maplibregl.GeoJSONSource | undefined
    source?.setData(toSyntheticPointCollection(props.syntheticPoint))
    if (props.syntheticPoint) {
      map.easeTo({
        center: [props.syntheticPoint.longitude, props.syntheticPoint.latitude],
        zoom: Math.max(map.getZoom(), 12),
        duration: 500,
      })
    }
  }, [props.syntheticPoint])

  return <div ref={containerRef} className="map" role="region" aria-label={props.ariaLabel ?? '인천 돌봄 수요 맥락 지도'} />
}

export function hasOperationalMapLayers(map: { getSource(id: string): unknown; getLayer(id: string): unknown }) {
  return OPERATIONAL_SOURCES.every((id) => map.getSource(id) !== undefined)
    && OPERATIONAL_LAYERS.every((id) => map.getLayer(id) !== undefined)
}

function toSyntheticPointCollection(point: MapViewProps['syntheticPoint']): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: point ? [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
      properties: { case_id: point.caseId, synthetic: true, display_marker: '[합성]' },
    }] : [],
  }
}

function updateContextStates(map: Map, props: MapViewProps) {
  if (!map.getSource(DONG_SOURCE)) return
  for (const feature of props.data.dongs.features) {
    const id = feature.properties.geometry_zone_id
    const operation = props.operationsByZone?.[id]
    map.setFeatureState({ source: DONG_SOURCE, id }, {
      acute: operation?.acute_color_metric ?? null,
    })
  }
}

function toBubbleCollection(data: DataBundle, operationsByZone?: MapViewProps['operationsByZone']): FeatureCollection<Point, DongProperties & { acute: number | null; vulnerability: number }> {
  return {
    type: 'FeatureCollection',
    features: data.dongs.features.map((feature) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [feature.properties.representative_longitude, feature.properties.representative_latitude],
      },
      properties: {
        ...feature.properties,
        acute: operationsByZone?.[feature.properties.geometry_zone_id]?.acute_color_metric ?? null,
        vulnerability: operationsByZone?.[feature.properties.geometry_zone_id]?.vulnerability_size_metric ?? 0,
      },
    })),
  }
}

function normalizeDongProperties(raw: Record<string, unknown>): DongProperties {
  const names = typeof raw.current_admin_dong_names_20260701 === 'string'
    ? JSON.parse(raw.current_admin_dong_names_20260701) as string[]
    : raw.current_admin_dong_names_20260701 as string[]
  return { ...raw, current_admin_dong_names_20260701: names } as unknown as DongProperties
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!)
}
