# I5 Data Bundle Inventory

- Raw files: 323
- Files with authoritative source URL cataloged: 322
- User-provided official files with no recorded external URL: 1
- Files needing source annotation: 0
- Data nature: local_provenance_record=1, observed_public=86, official_document=236; synthetic raw files=0.
- CSV encodings observed: cp949, utf-8-sig.
- API credentials were not generated. Items needing keys are listed in metadata/api_catalog.csv.
- API access status and already-downloaded local bulk status are recorded separately.

## Modeling Guardrail

Do not label map marks as confirmed unserved people, individual risk cases, or service-missing households. Public data supports observed aggregate indicators and separately documented demo/model signals only. The current utility bundle has no public Incheon household/person-level anomaly data; Jeongeup smart-meter data is model-demo-only, and future priority scores must stay separate from observed counts.

## Demo Layer Guardrail

`processed/demo_full_facility_points.geojson` is the internal hackathon default facility layer and includes official sensitive facility types when coordinates exist. Use `processed/public_demo_facility_points.geojson` and the other `public_demo_*` files as the conservative fallback for public sharing.

## Source Disclosure and License Guardrail

Every MVP layer should disclose its source and reference date. VWorld administrative boundary material is shown in the saved local spec as `CC BY-NC-ND`; derived GeoJSON redistribution or public-service use is not legally cleared by this inventory and needs a separate terms check or a redistributable replacement boundary source. See `LICENSES.md`.
