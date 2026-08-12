import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { request as httpRequest } from 'node:http';

import { createApiServer } from '../src/app.mjs';
import { createDataStore } from '../src/data-store.mjs';

const zones = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[126.5, 37.4], [126.6, 37.4], [126.6, 37.5], [126.5, 37.4]]],
      },
      properties: {
        geometry_zone_id: 'zone:alpha',
        current_district_name_20260701: '제물포구',
        current_admin_dong_names_20260701: ['연안동'],
        one_person_households_age_65_plus: 648,
        bubble_metric_interpretation: '관측된 규모이며 미수급자 수가 아님',
      },
    },
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[126.7, 37.5], [126.8, 37.5], [126.8, 37.6], [126.7, 37.5]]],
      },
      properties: {
        geometry_zone_id: 'zone:beta',
        current_district_name_20260701: '부평구',
        current_admin_dong_names_20260701: ['삼산1동'],
        one_person_households_age_65_plus: 700,
        bubble_metric_interpretation: '관측된 규모이며 미수급자 수가 아님',
      },
    },
  ],
};

const facilities = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [126.55, 37.45] },
      properties: {
        facility_id: 'fac-1',
        facility_name: '연안돌봄센터',
        district_scope_20260701: '제물포구',
        category_major: '지역복지',
        category_detail: '복지관',
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [126.75, 37.55] },
      properties: {
        facility_id: 'fac-2',
        facility_name: '삼산요양원',
        district_scope_20260701: '부평구',
        category_major: '노인복지',
        category_detail: '요양원',
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [126.76, 37.56] },
      properties: {
        facility_id: 'fac-3',
        facility_name: '삼산복지관',
        district_scope_20260701: '부평구',
        category_major: '지역복지',
        category_detail: '복지관',
      },
    },
  ],
};

const transit = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [126.54, 37.44] },
      properties: {
        place_id: 'bus:1',
        district: '제물포구',
        stop_name: '연안부두',
        total_board_alightings: 100,
        route_count: 2,
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [126.74, 37.54] },
      properties: {
        place_id: 'bus:2',
        district: '부평구',
        stop_name: '삼산체육관',
        total_board_alightings: 900,
        route_count: 8,
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [126.73, 37.53] },
      properties: {
        place_id: 'bus:3',
        district: '부평구',
        stop_name: '굴포천',
        total_board_alightings: 500,
        route_count: null,
      },
    },
  ],
};

const summary = {
  schemaVersion: 1,
  project: 'I5 도시 돌봄 우선검토 지도',
  metricGuardrail: '관측된 수이며 복지 미수급자 수 또는 고독사 위험자 수가 아님',
  counts: { adminGeometryZones: 2, facilityPoints: 3, transitUsagePoints: 3 },
};

const store = createDataStore({
  summary,
  zones,
  facilities,
  transit,
  validation: { status: 'pass' },
});

let server;
let baseUrl;

before(async () => {
  server = createApiServer({
    store,
    corsOrigins: ['https://care.example'],
    rateLimitPerMinute: 0,
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function getJson(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = response.status === 204 || response.status === 304 ? null : await response.json();
  return { response, body };
}

function rawRequest(path, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(baseUrl);
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path,
      method,
      headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.once('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

describe('health and response contract', () => {
  test('canonical external health check is stable, uncached, and versioned', async () => {
    const { response, body } = await getJson('/health');

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('x-request-id'), /^[A-Za-z0-9._:-]+$/);
    assert.deepEqual(body, {
      apiVersion: 'v1',
      data: { status: 'ok', dataStatus: 'pass' },
    });
  });

  test('keeps /healthz as a compatibility alias', async () => {
    const canonical = await getJson('/health');
    const alias = await getJson('/healthz');

    assert.equal(alias.response.status, 200);
    assert.deepEqual(alias.body, canonical.body);
    assert.equal(alias.response.headers.get('cache-control'), 'no-store');
  });

  test('uses a valid caller request ID and replaces an invalid one', async () => {
    const valid = await fetch(`${baseUrl}/healthz`, { headers: { 'x-request-id': 'trace-123' } });
    const invalid = await fetch(`${baseUrl}/healthz`, { headers: { 'x-request-id': '<script>' } });

    assert.equal(valid.headers.get('x-request-id'), 'trace-123');
    assert.notEqual(invalid.headers.get('x-request-id'), '<script>');
    assert.match(invalid.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  });

  test('returns stable ETags and honors If-None-Match', async () => {
    const first = await fetch(`${baseUrl}/api/v1/summary`);
    const etag = first.headers.get('etag');
    const firstBody = await first.json();
    const second = await fetch(`${baseUrl}/api/v1/summary`, {
      headers: { 'if-none-match': etag },
    });

    assert.equal(first.status, 200);
    assert.equal(firstBody.apiVersion, 'v1');
    assert.match(first.headers.get('cache-control'), /^public,/);
    assert.match(etag, /^"[a-f0-9]{64}"$/);
    assert.equal(second.status, 304);
    assert.equal(await second.text(), '');
  });

  test('accepts wildcard If-None-Match without emitting a response body', async () => {
    const response = await fetch(`${baseUrl}/api/v1/summary`, {
      headers: { 'if-none-match': '*' },
    });

    assert.equal(response.status, 304);
    assert.equal(await response.text(), '');
  });
});

describe('zones API', () => {
  test('lists and filters zone feature collections', async () => {
    const { response, body } = await getJson('/api/v1/zones?district=부평구&limit=1&offset=0');

    assert.equal(response.status, 200);
    assert.equal(body.data.type, 'FeatureCollection');
    assert.equal(body.data.features.length, 1);
    assert.equal(body.data.features[0].properties.geometry_zone_id, 'zone:beta');
    assert.deepEqual(body.meta.pagination, {
      limit: 1,
      offset: 0,
      total: 1,
      returned: 1,
      hasMore: false,
    });
  });

  test('returns a single zone by encoded geometry zone ID', async () => {
    const { response, body } = await getJson('/api/v1/zones/zone%3Aalpha');

    assert.equal(response.status, 200);
    assert.equal(body.data.properties.geometry_zone_id, 'zone:alpha');
  });

  test('spatially filters zones and returns an empty out-of-range page', async () => {
    const { body } = await getJson('/api/v1/zones?bbox=126.7,37.5,126.9,37.7&limit=1&offset=1');

    assert.equal(body.data.features.length, 0);
    assert.equal(body.meta.pagination.total, 1);
    assert.equal(body.meta.pagination.returned, 0);
  });

  test('returns JSON 404 for an unknown zone', async () => {
    const { response, body } = await getJson('/api/v1/zones/zone%3Amissing');

    assert.equal(response.status, 404);
    assert.equal(body.apiVersion, 'v1');
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.equal(body.requestId, response.headers.get('x-request-id'));
  });
});

describe('facilities API', () => {
  test('combines validated district, category, bbox, and pagination filters', async () => {
    const path = '/api/v1/facilities?district=부평구&category=지역복지&bbox=126.7,37.5,126.8,37.6&limit=1&offset=0';
    const { response, body } = await getJson(path);

    assert.equal(response.status, 200);
    assert.equal(body.data.features.length, 1);
    assert.equal(body.data.features[0].properties.facility_id, 'fac-3');
    assert.equal(body.meta.pagination.total, 1);
    assert.equal(body.meta.dataInterpretation, 'official-facility-locations-not-individual-beneficiaries');
  });

  for (const [query, parameter] of [
    ['district=없는구', 'district'],
    ['category=없는복지', 'category'],
    ['limit=0', 'limit'],
    ['limit=501', 'limit'],
    ['offset=-1', 'offset'],
    ['bbox=126,37,wrong,38', 'bbox'],
    ['bbox=126,37,126,38', 'bbox'],
    ['bbox=-180,-90,180,90', 'bbox'],
    ['unknown=value', 'unknown'],
  ]) {
    test(`rejects invalid ${parameter} input`, async () => {
      const { response, body } = await getJson(`/api/v1/facilities?${query}`);

      assert.equal(response.status, 400);
      assert.equal(body.error.code, 'INVALID_QUERY');
      assert.equal(body.requestId, response.headers.get('x-request-id'));
    });
  }
});

describe('transit API', () => {
  test('applies bounded numeric and spatial filters', async () => {
    const path = '/api/v1/transit?district=부평구&minTotalEvents=600&minRouteCount=3&bbox=126.7,37.5,126.8,37.6&limit=50';
    const { response, body } = await getJson(path);

    assert.equal(response.status, 200);
    assert.equal(body.data.features.length, 1);
    assert.equal(body.data.features[0].properties.place_id, 'bus:2');
    assert.equal(body.meta.pagination.total, 1);
  });

  for (const query of [
    'district=없는구',
    'minTotalEvents=-1',
    'minTotalEvents=100000001',
    'minRouteCount=-1',
    'minRouteCount=1001',
    'limit=nope',
  ]) {
    test(`rejects invalid bounded filter: ${query}`, async () => {
      const { response, body } = await getJson(`/api/v1/transit?${query}`);

      assert.equal(response.status, 400);
      assert.equal(body.error.code, 'INVALID_QUERY');
    });
  }
});

describe('CORS, methods, and privacy guardrails', () => {
  test('allows configured and localhost origins only', async () => {
    const configured = await fetch(`${baseUrl}/api/v1/summary`, {
      headers: { origin: 'https://care.example' },
    });
    const localhost = await fetch(`${baseUrl}/api/v1/summary`, {
      headers: { origin: 'http://localhost:5173' },
    });
    const denied = await fetch(`${baseUrl}/api/v1/summary`, {
      headers: { origin: 'https://evil.example' },
    });

    assert.equal(configured.headers.get('access-control-allow-origin'), 'https://care.example');
    assert.equal(localhost.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  });

  test('answers valid preflight and rejects unsupported methods', async () => {
    const preflight = await fetch(`${baseUrl}/api/v1/facilities`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://care.example',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'X-Request-ID',
      },
    });
    const post = await fetch(`${baseUrl}/api/v1/summary`, {
      method: 'POST',
      body: JSON.stringify({ ignored: true }),
      headers: { 'content-type': 'application/json' },
    });
    const postBody = await post.json();

    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, OPTIONS');
    assert.equal(postBody.error.code, 'METHOD_NOT_ALLOWED');
  });

  test('rejects unsupported preflight methods and headers', async () => {
    const method = await getJson('/api/v1/facilities', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://care.example',
        'access-control-request-method': 'POST',
      },
    });
    const header = await getJson('/api/v1/facilities', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://care.example',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'Authorization',
      },
    });

    assert.equal(method.response.status, 405);
    assert.equal(method.body.error.code, 'METHOD_NOT_ALLOWED');
    assert.equal(header.response.status, 400);
    assert.equal(header.body.error.code, 'INVALID_PREFLIGHT');
  });

  test('rejects duplicate query parameters, malformed IDs, and overlong URLs', async () => {
    const duplicate = await getJson('/api/v1/facilities?limit=1&limit=2');
    const malformed = await getJson('/api/v1/zones/%ZZ');
    const overlong = await getJson(`/api/v1/summary?padding=${'x'.repeat(4_100)}`);

    assert.equal(duplicate.response.status, 400);
    assert.equal(malformed.response.status, 400);
    assert.equal(malformed.body.error.code, 'INVALID_PATH');
    assert.equal(overlong.response.status, 414);
    assert.equal(overlong.body.error.code, 'URI_TOO_LONG');
  });

  test('returns JSON errors for unknown routes and disallows GET request bodies', async () => {
    const unknown = await getJson('/api/v2/summary');
    const bodyRequest = await rawRequest('/api/v1/summary', {
      headers: { 'content-length': '1' },
      body: 'x',
    });

    assert.equal(unknown.response.status, 404);
    assert.equal(unknown.body.error.code, 'NOT_FOUND');
    assert.equal(bodyRequest.status, 413);
    assert.equal(JSON.parse(bodyRequest.text).error.code, 'REQUEST_BODY_NOT_ALLOWED');
  });

  test('rejects unsafe CORS configuration and invalid rate-limit configuration at startup', () => {
    assert.throws(() => createApiServer({ store, corsOrigins: ['*'] }), /wildcard/);
    assert.throws(() => createApiServer({ store, corsOrigins: ['ftp:\/\/care.example'] }), /Invalid CORS origin/);
    assert.throws(() => createApiServer({ store, corsOrigins: ['https:\/\/care.example/path'] }), /must not include/);
    assert.throws(() => createApiServer({ store, rateLimitPerMinute: -1 }), /RATE_LIMIT/);
  });

  test('enforces the coarse per-instance rate limit', async () => {
    const limitedServer = createApiServer({ store, rateLimitPerMinute: 1 });
    await new Promise((resolve, reject) => {
      limitedServer.once('error', reject);
      limitedServer.listen(0, '127.0.0.1', resolve);
    });
    const address = limitedServer.address();
    const limitedBaseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const first = await fetch(`${limitedBaseUrl}/api/v1/summary`, {
        headers: { 'x-forwarded-for': '198.51.100.10' },
      });
      const second = await fetch(`${limitedBaseUrl}/api/v1/summary`, {
        headers: { 'x-forwarded-for': '203.0.113.20' },
      });
      const body = await second.json();

      assert.equal(first.status, 200);
      assert.equal(second.status, 429);
      assert.equal(body.error.code, 'RATE_LIMITED');
      assert.match(second.headers.get('retry-after'), /^\d+$/);
    } finally {
      await new Promise((resolve) => limitedServer.close(resolve));
    }
  });

  test('returns a generic 500 envelope without leaking internal details', async () => {
    const logEntries = [];
    const failingStore = new Proxy(store, {
      get(target, property, receiver) {
        if (property === 'summary') throw new Error('/private/data/summary.json failed');
        return Reflect.get(target, property, receiver);
      },
    });
    const failingServer = createApiServer({
      store: failingStore,
      rateLimitPerMinute: 0,
      logger: { error: (entry) => logEntries.push(entry) },
    });
    await new Promise((resolve, reject) => {
      failingServer.once('error', reject);
      failingServer.listen(0, '127.0.0.1', resolve);
    });
    const address = failingServer.address();
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/summary`);
      const text = await response.text();
      const body = JSON.parse(text);

      assert.equal(response.status, 500);
      assert.equal(body.error.code, 'INTERNAL_ERROR');
      assert.equal(body.error.message, 'An internal server error occurred.');
      assert.equal(text.includes('/private/data'), false);
      assert.equal(logEntries.length, 1);
    } finally {
      await new Promise((resolve) => failingServer.close(resolve));
    }
  });

  test('never emits inferred beneficiary, unserved-person, or risk-score fields', async () => {
    const responses = await Promise.all([
      getJson('/api/v1/summary'),
      getJson('/api/v1/zones'),
      getJson('/api/v1/facilities'),
      getJson('/api/v1/transit'),
    ]);
    const keys = new Set();
    const collectKeys = (value) => {
      if (Array.isArray(value)) return value.forEach(collectKeys);
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          keys.add(key.toLowerCase());
          collectKeys(child);
        }
      }
    };
    responses.forEach(({ body }) => collectKeys(body));

    for (const forbidden of ['beneficiary', 'unserved', 'non_recipient', 'risk_score', 'priority_score']) {
      assert.equal(keys.has(forbidden), false, `unexpected inferred field: ${forbidden}`);
    }
  });
});
