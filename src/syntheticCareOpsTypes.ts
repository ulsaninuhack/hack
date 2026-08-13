/**
 * Contract for the deterministic CareOps fixture files in public/data.
 *
 * These records model synthetic operational tasks. They are not people,
 * beneficiaries, care gaps, or individual-risk predictions.
 */

export type GeometryResolution =
  | 'exact_2025_geometry_zone'
  | 'shared_pre_reform_2025_geometry_zone'
  | 'shared_parent_2025_geometry_zone'
  | 'shared_2025_geometry_zone'

export interface SyntheticSpatialLocation {
  longitude: number
  latitude: number
  geometry_zone_id: string
  current_admin_dong_code_20260701: string
  current_admin_dong_name_20260701: string
  current_district_name_20260701: string
  geometry_resolution: GeometryResolution
  mapping_method: string
}

export interface SyntheticWorkerLocation extends SyntheticSpatialLocation {
  spatial_basis: 'synthetic_point_within_2025_geometry_zone'
}

export interface SyntheticHouseholdLocation extends SyntheticSpatialLocation {
  spatial_basis: 'official_residential_building_address_reference'
  reference_pnu: string
  road_address: string
  building_name: string
  main_use_names: string[]
  apartment_reference: boolean
  residential_building_reference: true
  address_source: 'MOIS_JUSO_BUILDING_DB_202607'
  coordinate_source:
    | 'VWORLD_AL_D010_PNU_REPRESENTATIVE_POINT_20260809'
    | 'OPENSTREETMAP_NOMINATIM_RESIDENTIAL_FEATURE_20260813'
  residential_classification_sources: Array<
    | 'VWORLD_BUILDING_AGE_REGISTER_20260805'
    | 'MOIS_JUSO_BUILDING_DB_202607_COLLECTIVE_HOUSING_FLAG'
  >
  not_real_resident: true
}

export interface TimeWindow {
  start: string
  end: string
}

export interface SyntheticWorker {
  id: string
  synthetic: true
  display_name: string
  role: 'neighbor_connector'
  location: SyntheticWorkerLocation
  constraints: {
    stairs_allowed: boolean
    available_time_window: TimeWindow
    max_daily_approved_visits: number
    assigned_admin_dong_codes_20260701: string[]
    travel_modes: Array<'walking' | 'public_transit' | 'car'>
  }
  matching_profile: {
    gender_for_preference_matching: 'female' | 'male' | 'not_specified'
  }
  workflow: {
    availability_status: 'available' | 'assigned' | 'on_visit' | 'off_shift'
  }
}

export type ContactResult =
  | 'not_attempted'
  | 'connected_ok'
  | 'connected_concern'
  | 'no_answer'
  | 'refused'
  | 'invalid_contact'

export type VisitApprovalStatus =
  | 'recommended'
  | 'approved'
  | 'rejected'
  | null

export type TransferStatus =
  | 'not_required'
  | 'recommended'
  | 'requested'
  | 'transferred'
  | 'closed'

export interface SyntheticHouseholdTask {
  id: string
  synthetic: true
  location: SyntheticHouseholdLocation
  contact: {
    next_contact_date: string
    preferred_contact_method: 'phone' | 'visit'
    contact_cadence_days: 3 | 7 | 14
    last_contact_date: string | null
    last_contact_result: ContactResult
    consecutive_no_answer_count: number
  }
  visit_context: {
    preferred_visit_time_window: TimeWindow
    preferred_worker_gender: 'any' | 'female' | 'male'
    stairs_present: boolean
    service_duration_minutes: 20 | 30 | 40 | 60
    requires_two_person_team: boolean
    requires_public_official_companion: boolean
  }
  workflow: {
    follow_up_deadline: string | null
    follow_up_status: 'none' | 'required' | 'overdue' | 'completed'
    visit_approval_status: VisitApprovalStatus
    transfer_status: TransferStatus
    visit_decision: {
      decision: 'approved' | 'rejected'
      decided_by: string
      decided_at: string
      note: string
    } | null
  }
  approved_visit_constraints: {
    max_route_distance_km: number
    assigned_worker_ids: string[]
    routing_interpretation: 'approved_visit_only_not_person_risk'
  } | null
}

interface SyntheticDatasetBase {
  schema_version: '2.0.0'
  synthetic: true
  scenario_reference_date: string
  seed: number
  guardrail: string
  spatial_contract: {
    current_admin_reference_date: '2026-07-01'
    geometry_reference_date: '2025-06-30'
    current_admin_dong_count: 162
    geometry_zone_count: 156
    note: string
  }
}

export interface SyntheticWorkerDataset extends SyntheticDatasetBase {
  dataset_id: 'incheon-care-ops-synthetic-workers-v2'
  workers: SyntheticWorker[]
}

export interface SyntheticHouseholdDataset extends SyntheticDatasetBase {
  dataset_id: 'incheon-care-ops-synthetic-households-v2'
  households: SyntheticHouseholdTask[]
}

export function isApprovedSyntheticVisit(
  task: SyntheticHouseholdTask,
): boolean {
  return (
    task.synthetic === true &&
    task.workflow.visit_approval_status === 'approved' &&
    task.workflow.visit_decision?.decision === 'approved' &&
    task.approved_visit_constraints !== null
  )
}
