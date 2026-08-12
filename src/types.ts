import type { FeatureCollection, Geometry, Point } from 'geojson'

export type MetricKey =
  | 'age_65_plus_one_person_share_of_age_65_plus_population'
  | 'one_person_households_age_65_plus'
  | 'housing_age_30_plus_share_valid_pct'

export interface DongProperties {
  geometry_zone_id: string
  current_district_name_20260701: string
  current_admin_dong_names_20260701: string[]
  map_unit_status: 'exact' | 'aggregated_split' | 'parent_with_branch_office'
  population_reference_date: string
  household_reference_date: string
  total_population: number
  population_age_65_plus: number
  one_person_households: number
  one_person_households_age_65_plus: number
  age_65_plus_one_person_share_of_age_65_plus_population: number
  representative_longitude: number
  representative_latitude: number
  housing_age_30_plus_share_valid_pct: number | null
  housing_age_30_plus_records: number
  housing_age_coverage_pct: number | null
}

export interface FacilityProperties {
  facility_id: string
  facility_name: string
  district_scope_20260701: string
  admin_dong_name_20260701: string
  official_address: string
  category_major: string
  category_detail: string
  facility_form: string
  source_as_of_date_latest: string
  coordinate_is_representative_point: boolean
}

export interface TransitProperties {
  place_id: string
  stop_number: string
  stop_name: string
  district: string
  dong: string
  reference_date: string
  boardings: number
  alightings: number
  total_board_alightings: number
  daily_average_board_alightings: number
  route_count: number | null
  route_numbers: string[]
}

export interface Summary {
  cityTotals: {
    total_population: number
    population_age_65_plus: number
    one_person_households_age_65_plus: number
    housing: { age_30_plus_records: number }
  }
  counts: {
    adminGeometryZones: number
    currentAdminDongsRepresented: number
    facilityCanonicalTotal: number
    facilityPoints: number
    transitUsagePoints: number
  }
  coverage: { facilityCoordinateCoveragePct: number }
  snapshotDates: Record<string, unknown>
  metricGuardrail: string
  caveats: string[]
}

export type DongCollection = FeatureCollection<Geometry, DongProperties>
export type FacilityCollection = FeatureCollection<Point, FacilityProperties>
export type TransitCollection = FeatureCollection<Point, TransitProperties>

export interface DataBundle {
  dongs: DongCollection
  facilities: FacilityCollection
  transit: TransitCollection
  summary: Summary
  runtimeSource: 'api' | 'static' | 'static-fallback'
}
