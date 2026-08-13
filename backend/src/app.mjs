import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { LiveCallError, SDP_MAX_BYTES } from './live-call-service.mjs';
import { VoiceAudioUploadError } from './voice-audio-upload.mjs';

const API_VERSION = 'v1';
const DEFAULT_LIMIT = 200;
const MAX_LIST_LIMIT = 500;
const MAX_ZONE_LIMIT = 200;
const MAX_OFFSET = 100_000;
const MAX_BBOX_SPAN_DEGREES = 5;
const MAX_TOTAL_EVENTS = 100_000_000;
const MAX_ROUTE_COUNT = 1_000;
const MAX_URL_LENGTH = 4_096;
const DATA_INTERPRETATION = 'official-facility-locations-not-individual-beneficiaries';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const ALLOWED_PREFLIGHT_HEADERS = new Set(['accept', 'content-type', 'x-request-id']);
const CASE_ID_PATTERN = /^SYN-HH-\d{10}-\d{4}$/;
const WORKER_ID_PATTERN = /^SYN-W-\d{10}-01$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const SURVEYOR_DISPLAY_ID_PATTERN = /^연결단원 [0-9]{3}$/;
const AUDIO_FILE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:wav|mp3|m4a)$/i;

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function normalizeConfiguredOrigins(origins) {
  const values = typeof origins === 'string' ? origins.split(',') : (origins || []);
  return new Set(values.map((value) => value.trim()).filter(Boolean).map((value) => {
    if (value === '*') throw new Error('CORS_ORIGINS cannot contain a wildcard');
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error(`Invalid CORS origin: ${value}`);
    }
    if (url.pathname !== '/' || url.search || url.hash) {
      throw new Error(`CORS origin must not include a path, query, or fragment: ${value}`);
    }
    return url.origin;
  }));
}

function isLocalDevelopmentOrigin(origin) {
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function createCorsPolicy(origins) {
  const configured = normalizeConfiguredOrigins(origins);
  return {
    allows(origin) {
      return !origin || configured.has(origin) || isLocalDevelopmentOrigin(origin);
    },
  };
}

function requestIdFor(request) {
  const supplied = request.headers['x-request-id'];
  const candidate = Array.isArray(supplied) ? supplied[0] : supplied;
  return typeof candidate === 'string' && REQUEST_ID_PATTERN.test(candidate)
    ? candidate
    : randomUUID();
}

function securityHeaders(requestId, origin, corsAllowed) {
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Download-Options': 'noopen',
    'X-Frame-Options': 'DENY',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'X-Request-ID': requestId,
  };
  if (origin && corsAllowed) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function createEtag(payload) {
  return `"${createHash('sha256').update(payload).digest('hex')}"`;
}

function hasMatchingEtag(request, etag) {
  const value = request.headers['if-none-match'];
  if (typeof value !== 'string') return false;
  return value.split(',').some((candidate) => candidate.trim() === etag || candidate.trim() === '*');
}

function sendJson(request, response, status, value, context, cacheable = false) {
  const payload = JSON.stringify(value);
  const headers = securityHeaders(context.requestId, context.origin, context.corsAllowed);
  headers['Content-Type'] = 'application/json; charset=utf-8';
  headers['Content-Length'] = Buffer.byteLength(payload);

  if (cacheable) {
    const etag = createEtag(payload);
    headers['Cache-Control'] = 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400';
    headers.ETag = etag;
    if (hasMatchingEtag(request, etag)) {
      delete headers['Content-Type'];
      delete headers['Content-Length'];
      response.writeHead(304, headers);
      response.end();
      return;
    }
  }

  response.writeHead(status, headers);
  response.end(payload);
}

function sendSdp(request, response, status, value, context) {
  const headers = securityHeaders(context.requestId, context.origin, context.corsAllowed);
  headers['Content-Type'] = 'application/sdp; charset=utf-8';
  headers['Content-Length'] = Buffer.byteLength(value);
  response.writeHead(status, headers);
  response.end(value);
}

function sendError(request, response, error, context) {
  const operational = error instanceof ApiError;
  const status = operational ? error.status : 500;
  const body = {
    apiVersion: API_VERSION,
    error: {
      code: operational ? error.code : 'INTERNAL_ERROR',
      message: operational ? error.message : 'An internal server error occurred.',
      ...(operational && error.details ? { details: error.details } : {}),
    },
    requestId: context.requestId,
  };
  if (status === 405) response.setHeader('Allow', 'GET, OPTIONS');
  if (status === 429 && error.details?.retryAfterSeconds) {
    response.setHeader('Retry-After', error.details.retryAfterSeconds);
  }
  sendJson(request, response, status, body, context, false);
}

function assertKnownQuery(searchParams, allowed) {
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) {
      throw new ApiError(400, 'INVALID_QUERY', `Unsupported query parameter: ${key}`, {
        parameter: key,
        allowedParameters: [...allowed],
      });
    }
    if (searchParams.getAll(key).length > 1) {
      throw new ApiError(400, 'INVALID_QUERY', `Query parameter must appear once: ${key}`, {
        parameter: key,
      });
    }
  }
}

function parseInteger(searchParams, name, { defaultValue, min, max }) {
  const raw = searchParams.get(name);
  if (raw === null) return defaultValue;
  if (!/^(0|[1-9]\d*)$/.test(raw)) {
    throw new ApiError(400, 'INVALID_QUERY', `${name} must be an integer`, { parameter: name, min, max });
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ApiError(400, 'INVALID_QUERY', `${name} must be between ${min} and ${max}`, {
      parameter: name,
      min,
      max,
    });
  }
  return value;
}

function parseAllowedValue(searchParams, name, allowedValues) {
  const value = searchParams.get(name);
  if (value === null) return null;
  if (!allowedValues.includes(value)) {
    throw new ApiError(400, 'INVALID_QUERY', `Unsupported ${name}`, {
      parameter: name,
      allowedValues,
    });
  }
  return value;
}

function parseBbox(searchParams) {
  const raw = searchParams.get('bbox');
  if (raw === null) return null;
  const parts = raw.split(',');
  if (parts.length !== 4 || parts.some((part) => part.trim() === '' || !Number.isFinite(Number(part)))) {
    throw new ApiError(400, 'INVALID_QUERY', 'bbox must contain four finite numbers', {
      parameter: 'bbox',
      format: 'minLongitude,minLatitude,maxLongitude,maxLatitude',
    });
  }
  const [minLongitude, minLatitude, maxLongitude, maxLatitude] = parts.map(Number);
  if (
    minLongitude < -180 || maxLongitude > 180
    || minLatitude < -90 || maxLatitude > 90
    || minLongitude >= maxLongitude || minLatitude >= maxLatitude
  ) {
    throw new ApiError(400, 'INVALID_QUERY', 'bbox coordinates are out of order or range', {
      parameter: 'bbox',
    });
  }
  if (
    maxLongitude - minLongitude > MAX_BBOX_SPAN_DEGREES
    || maxLatitude - minLatitude > MAX_BBOX_SPAN_DEGREES
  ) {
    throw new ApiError(400, 'INVALID_QUERY', `bbox span must not exceed ${MAX_BBOX_SPAN_DEGREES} degrees`, {
      parameter: 'bbox',
      maxSpanDegrees: MAX_BBOX_SPAN_DEGREES,
    });
  }
  return [minLongitude, minLatitude, maxLongitude, maxLatitude];
}

function geometryBounds(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  let minLongitude = Infinity;
  let minLatitude = Infinity;
  let maxLongitude = -Infinity;
  let maxLatitude = -Infinity;

  const visit = (coordinates) => {
    if (
      Array.isArray(coordinates)
      && coordinates.length >= 2
      && Number.isFinite(coordinates[0])
      && Number.isFinite(coordinates[1])
    ) {
      minLongitude = Math.min(minLongitude, coordinates[0]);
      minLatitude = Math.min(minLatitude, coordinates[1]);
      maxLongitude = Math.max(maxLongitude, coordinates[0]);
      maxLatitude = Math.max(maxLatitude, coordinates[1]);
      return;
    }
    if (Array.isArray(coordinates)) coordinates.forEach(visit);
  };
  visit(geometry.coordinates);

  return Number.isFinite(minLongitude)
    ? [minLongitude, minLatitude, maxLongitude, maxLatitude]
    : null;
}

function intersectsBbox(feature, bbox) {
  if (!bbox) return true;
  const bounds = geometryBounds(feature.geometry);
  if (!bounds) return false;
  return bounds[0] <= bbox[2]
    && bounds[2] >= bbox[0]
    && bounds[1] <= bbox[3]
    && bounds[3] >= bbox[1];
}

function paginate(features, limit, offset) {
  return {
    features: features.slice(offset, offset + limit),
    pagination: {
      limit,
      offset,
      total: features.length,
      returned: Math.max(0, Math.min(limit, features.length - offset)),
      hasMore: offset + limit < features.length,
    },
  };
}

function featureCollection(features) {
  return { type: 'FeatureCollection', features };
}

function routeSummary(store, url) {
  assertKnownQuery(url.searchParams, new Set());
  return { apiVersion: API_VERSION, data: store.summary };
}

function routeZones(store, url) {
  const allowed = new Set(['district', 'bbox', 'limit', 'offset']);
  assertKnownQuery(url.searchParams, allowed);
  const district = parseAllowedValue(url.searchParams, 'district', store.options.zoneDistricts);
  const bbox = parseBbox(url.searchParams);
  const limit = parseInteger(url.searchParams, 'limit', {
    defaultValue: MAX_ZONE_LIMIT,
    min: 1,
    max: MAX_ZONE_LIMIT,
  });
  const offset = parseInteger(url.searchParams, 'offset', { defaultValue: 0, min: 0, max: MAX_OFFSET });
  const filtered = store.zones.features.filter((feature) => (
    (!district || feature.properties.current_district_name_20260701 === district)
    && intersectsBbox(feature, bbox)
  ));
  const page = paginate(filtered, limit, offset);
  return {
    apiVersion: API_VERSION,
    data: featureCollection(page.features),
    meta: {
      pagination: page.pagination,
      filters: { district, bbox },
      dataInterpretation: DATA_INTERPRETATION,
    },
  };
}

function routeZoneDetail(store, url, encodedId) {
  assertKnownQuery(url.searchParams, new Set());
  let geometryZoneId;
  try {
    geometryZoneId = decodeURIComponent(encodedId);
  } catch {
    throw new ApiError(400, 'INVALID_PATH', 'geometryZoneId is not valid URL encoding');
  }
  if (!geometryZoneId || geometryZoneId.length > 200) {
    throw new ApiError(400, 'INVALID_PATH', 'geometryZoneId is invalid');
  }
  const zone = store.zoneById.get(geometryZoneId);
  if (!zone) throw new ApiError(404, 'NOT_FOUND', 'Zone not found');
  return {
    apiVersion: API_VERSION,
    data: zone,
    meta: { dataInterpretation: DATA_INTERPRETATION },
  };
}

function routeFacilities(store, url) {
  const allowed = new Set(['district', 'category', 'bbox', 'limit', 'offset']);
  assertKnownQuery(url.searchParams, allowed);
  const district = parseAllowedValue(url.searchParams, 'district', store.options.facilityDistricts);
  const category = parseAllowedValue(url.searchParams, 'category', store.options.facilityCategories);
  const bbox = parseBbox(url.searchParams);
  const limit = parseInteger(url.searchParams, 'limit', {
    defaultValue: DEFAULT_LIMIT,
    min: 1,
    max: MAX_LIST_LIMIT,
  });
  const offset = parseInteger(url.searchParams, 'offset', { defaultValue: 0, min: 0, max: MAX_OFFSET });
  const filtered = store.facilities.features.filter((feature) => (
    (!district || feature.properties.district_scope_20260701 === district)
    && (!category || feature.properties.category_major === category)
    && intersectsBbox(feature, bbox)
  ));
  const page = paginate(filtered, limit, offset);
  return {
    apiVersion: API_VERSION,
    data: featureCollection(page.features),
    meta: {
      pagination: page.pagination,
      filters: { district, category, bbox },
      dataInterpretation: DATA_INTERPRETATION,
    },
  };
}

function routeTransit(store, url) {
  const allowed = new Set([
    'district',
    'bbox',
    'minTotalEvents',
    'minRouteCount',
    'limit',
    'offset',
  ]);
  assertKnownQuery(url.searchParams, allowed);
  const district = parseAllowedValue(url.searchParams, 'district', store.options.transitDistricts);
  const bbox = parseBbox(url.searchParams);
  const minTotalEvents = parseInteger(url.searchParams, 'minTotalEvents', {
    defaultValue: 0,
    min: 0,
    max: MAX_TOTAL_EVENTS,
  });
  const minRouteCount = parseInteger(url.searchParams, 'minRouteCount', {
    defaultValue: 0,
    min: 0,
    max: MAX_ROUTE_COUNT,
  });
  const limit = parseInteger(url.searchParams, 'limit', {
    defaultValue: DEFAULT_LIMIT,
    min: 1,
    max: MAX_LIST_LIMIT,
  });
  const offset = parseInteger(url.searchParams, 'offset', { defaultValue: 0, min: 0, max: MAX_OFFSET });
  const filtered = store.transit.features.filter((feature) => {
    const properties = feature.properties;
    const routeCount = Number.isFinite(properties.route_count) ? properties.route_count : 0;
    return (!district || properties.district === district)
      && properties.total_board_alightings >= minTotalEvents
      && routeCount >= minRouteCount
      && intersectsBbox(feature, bbox);
  });
  const page = paginate(filtered, limit, offset);
  return {
    apiVersion: API_VERSION,
    data: featureCollection(page.features),
    meta: {
      pagination: page.pagination,
      filters: { district, bbox, minTotalEvents, minRouteCount },
      dataInterpretation: DATA_INTERPRETATION,
    },
  };
}

class FixedWindowRateLimiter {
  constructor(limit) {
    this.limit = limit;
    this.clients = new Map();
  }

  consume(key, now = Date.now()) {
    if (this.limit <= 0) return { allowed: true };
    const windowMilliseconds = 60_000;
    let state = this.clients.get(key);
    if (!state || now - state.startedAt >= windowMilliseconds) {
      state = { startedAt: now, count: 0 };
      this.clients.set(key, state);
    }
    state.count += 1;

    if (this.clients.size > 10_000) {
      const oldestKey = this.clients.keys().next().value;
      this.clients.delete(oldestKey);
    }

    return {
      allowed: state.count <= this.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((state.startedAt + windowMilliseconds - now) / 1_000)),
    };
  }
}

function clientKey(request) {
  // Forwarding headers are caller-controlled unless every proxy hop is trusted.
  // This limiter is deliberately coarse; production-wide enforcement belongs at
  // Cloud Armor/API Gateway, where the client address is established upstream.
  return (request.socket.remoteAddress || 'unknown').slice(0, 128);
}

function rejectBodyBearingRequest(request) {
  const contentLength = request.headers['content-length'];
  if (request.headers['transfer-encoding']) return true;
  if (contentLength === undefined) return false;
  return !/^\d+$/.test(contentLength) || Number(contentLength) > 0;
}

function handlePreflight(request, response, context) {
  const requestedMethod = request.headers['access-control-request-method'];
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  const operations = pathname.startsWith('/api/v1/contact-ops');
  const realtimeSdp = pathname === '/api/v1/contact-ops/live-calls/realtime-sdp';
  if (requestedMethod && (!['GET', 'POST'].includes(requestedMethod) || (requestedMethod === 'POST' && !operations))) {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Only GET, POST, and OPTIONS are supported');
  }
  const requestedHeaders = String(request.headers['access-control-request-headers'] || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const allowedHeaders = new Set(ALLOWED_PREFLIGHT_HEADERS);
  if (operations) allowedHeaders.add('x-demo-session-id');
  if (realtimeSdp) allowedHeaders.add('authorization');
  const unsupported = requestedHeaders.filter((header) => !allowedHeaders.has(header));
  if (unsupported.length > 0) {
    throw new ApiError(400, 'INVALID_PREFLIGHT', 'Unsupported preflight request headers', {
      unsupportedHeaders: unsupported,
    });
  }
  const headers = securityHeaders(context.requestId, context.origin, context.corsAllowed);
  headers['Access-Control-Allow-Methods'] = operations ? 'GET, POST, OPTIONS' : 'GET, OPTIONS';
  headers['Access-Control-Allow-Headers'] = realtimeSdp
    ? 'Accept, Authorization, Content-Type, X-Request-ID, X-Demo-Session-ID'
    : operations
      ? 'Accept, Content-Type, X-Request-ID, X-Demo-Session-ID'
      : 'Accept, Content-Type, X-Request-ID';
  headers['Access-Control-Max-Age'] = '600';
  headers['Cache-Control'] = 'public, max-age=600';
  response.writeHead(204, headers);
  response.end();
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''; request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; if (body.length > 20_000) reject(new ApiError(413, 'REQUEST_TOO_LARGE', 'Request body is too large')); });
    request.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON')); } });
    request.on('error', reject);
  });
}
function readTextBody(request, maxBytes = SDP_MAX_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new ApiError(413, 'REQUEST_TOO_LARGE', 'Request body is too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}
function bearerToken(request) {
  const value = request.headers.authorization;
  const match = typeof value === 'string' && value.length <= 4_096
    ? /^Bearer ([A-Za-z0-9._~-]+)$/.exec(value)
    : null;
  if (!match) throw new ApiError(401, 'LIVE_CALL_UNAUTHORIZED', '통화 참여 정보를 확인할 수 없습니다.');
  return match[1];
}
function exactBody(body, keys) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== keys.length || keys.some((key) => !Object.hasOwn(body, key))) {
    throw new ApiError(400, 'INVALID_BODY', 'Request body does not match the required contract');
  }
  return body;
}
function assertIsoDateValue(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
      || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new ApiError(400, 'INVALID_BODY', `${label} must be a valid ISO date`);
  }
}
function sessionFor(request, { required = false } = {}) {
  const value = request.headers['x-demo-session-id'];
  const sessionId = Array.isArray(value) ? value[0] : value;
  if (sessionId === undefined && !required) return 'read-only-demo-session';
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) throw new ApiError(400, 'INVALID_SESSION', 'X-Demo-Session-ID is invalid');
  return sessionId;
}
function caseIdFrom(pathname, suffix = '') {
  const prefix = '/api/v1/contact-ops/cases/';
  const id = pathname.slice(prefix.length, suffix ? -suffix.length : undefined);
  if (!CASE_ID_PATTERN.test(id)) throw new ApiError(400, 'INVALID_PATH', 'caseId must be a synthetic case ID');
  return id;
}
const THREE_TIER_PREFIX = '/api/v1/contact-ops/three-tier/';
const DONG_CODE_QUERY_PATTERN = /^\d{10}$/;

async function routeThreeTier(request, url, threeTierService) {
  if (!threeTierService) throw new ApiError(503, 'CONTACT_OPS_UNAVAILABLE', 'Three-tier adapter is unavailable');
  const readSession = () => sessionFor(request);
  const readIsoDate = (name) => {
    const value = url.searchParams.get(name);
    try { assertIsoDateValue(value, name); } catch { throw new ApiError(400, 'INVALID_QUERY', `${name} must be a valid ISO date`); }
    return value;
  };
  if (request.method === 'GET') {
    if (url.pathname === `${THREE_TIER_PREFIX}today-lanes`) {
      assertKnownQuery(url.searchParams, new Set(['referenceDate', 'workerId']));
      const workerId = url.searchParams.get('workerId');
      if (workerId === null || !WORKER_ID_PATTERN.test(workerId)) throw new ApiError(400, 'INVALID_QUERY', 'workerId must be synthetic');
      return threeTierService.getTodayLanes({ sessionId: readSession(), referenceDate: readIsoDate('referenceDate'), workerId });
    }
    if (url.pathname === `${THREE_TIER_PREFIX}center-inbox`) {
      assertKnownQuery(url.searchParams, new Set(['referenceDate', 'dongCode']));
      const dongCode = url.searchParams.get('dongCode');
      if (dongCode === null || !DONG_CODE_QUERY_PATTERN.test(dongCode)) throw new ApiError(400, 'INVALID_QUERY', 'dongCode must be a 10-digit current admin dong code');
      return threeTierService.getCenterInbox({ sessionId: readSession(), dongCode, referenceDate: readIsoDate('referenceDate') });
    }
    if (url.pathname.startsWith(`${THREE_TIER_PREFIX}report-cards/`)) {
      assertKnownQuery(url.searchParams, new Set());
      const caseId = url.pathname.slice(`${THREE_TIER_PREFIX}report-cards/`.length);
      if (!CASE_ID_PATTERN.test(caseId)) throw new ApiError(400, 'INVALID_PATH', 'caseId must be a synthetic case ID');
      return threeTierService.getReportCard({ sessionId: readSession(), caseId });
    }
    if (url.pathname.startsWith(`${THREE_TIER_PREFIX}case-history-summaries/`)) {
      assertKnownQuery(url.searchParams, new Set());
      const caseId = url.pathname.slice(`${THREE_TIER_PREFIX}case-history-summaries/`.length);
      if (!CASE_ID_PATTERN.test(caseId)) throw new ApiError(400, 'INVALID_PATH', 'caseId must be a synthetic case ID');
      return threeTierService.getCaseHistorySummary({ sessionId: readSession(), caseId });
    }
    if (url.pathname.startsWith(`${THREE_TIER_PREFIX}case-histories/`)) {
      assertKnownQuery(url.searchParams, new Set());
      const caseId = url.pathname.slice(`${THREE_TIER_PREFIX}case-histories/`.length);
      if (!CASE_ID_PATTERN.test(caseId)) throw new ApiError(400, 'INVALID_PATH', 'caseId must be a synthetic case ID');
      return threeTierService.getCaseHistory({ sessionId: readSession(), caseId });
    }
    if (url.pathname === `${THREE_TIER_PREFIX}center-calendar`) {
      assertKnownQuery(url.searchParams, new Set(['dongCode', 'month']));
      const dongCode = url.searchParams.get('dongCode');
      if (dongCode === null || !DONG_CODE_QUERY_PATTERN.test(dongCode)) throw new ApiError(400, 'INVALID_QUERY', 'dongCode must be a 10-digit current admin dong code');
      const month = url.searchParams.get('month');
      if (month === null || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, 'INVALID_QUERY', 'month must use the YYYY-MM form');
      return threeTierService.getCenterCalendar({ sessionId: readSession(), dongCode, month });
    }
    if (url.pathname === `${THREE_TIER_PREFIX}city-operations-map`) {
      assertKnownQuery(url.searchParams, new Set());
      return threeTierService.getCityOperationsMap({ sessionId: readSession() });
    }
    if (url.pathname === `${THREE_TIER_PREFIX}district-aggregates`) {
      assertKnownQuery(url.searchParams, new Set(['referenceDate']));
      return threeTierService.getDistrictAggregates({ sessionId: readSession(), referenceDate: readIsoDate('referenceDate') });
    }
    if (url.pathname === `${THREE_TIER_PREFIX}district-ai-summary`) {
      assertKnownQuery(url.searchParams, new Set(['referenceDate', 'district']));
      const district = url.searchParams.get('district');
      if (typeof district !== 'string' || district.length === 0 || district.length > 40) throw new ApiError(400, 'INVALID_QUERY', 'district is required');
      return threeTierService.getDistrictAiSummary({ sessionId: readSession(), district, referenceDate: readIsoDate('referenceDate') });
    }
    throw new ApiError(404, 'NOT_FOUND', 'Route not found');
  }
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Three-tier routes support GET, POST, and OPTIONS');
  if (!/^application\/json(?:;|$)/i.test(String(request.headers['content-type'] || ''))) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  const sessionId = sessionFor(request, { required: true });
  const body = await readBody(request);
  if (url.pathname === `${THREE_TIER_PREFIX}report-acknowledgements`) {
    exactBody(body, ['case_id', 'expected_revision', 'acknowledged_by']);
    if (!CASE_ID_PATTERN.test(body.case_id || '')) throw new ApiError(400, 'INVALID_BODY', 'case_id must be a synthetic case ID');
    if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0) throw new ApiError(400, 'INVALID_BODY', 'expected_revision must be a non-negative integer');
    return threeTierService.acknowledgeReport({ sessionId, caseId: body.case_id, expectedRevision: body.expected_revision, acknowledgedBy: body.acknowledged_by });
  }
  if (url.pathname === `${THREE_TIER_PREFIX}assignment-confirmations`) {
    exactBody(body, ['dong_code', 'reference_date', 'confirmed_by', 'case_ids']);
    assertIsoDateValue(body.reference_date, 'reference_date');
    return threeTierService.confirmAssignment({ sessionId, dongCode: body.dong_code, referenceDate: body.reference_date, confirmedBy: body.confirmed_by, caseIds: body.case_ids });
  }
  if (url.pathname === `${THREE_TIER_PREFIX}escalations`) {
    exactBody(body, ['case_id', 'reported_by']);
    if (!CASE_ID_PATTERN.test(body.case_id || '')) throw new ApiError(400, 'INVALID_BODY', 'case_id must be a synthetic case ID');
    return threeTierService.escalateCase({ sessionId, caseId: body.case_id, reportedBy: body.reported_by });
  }
  throw new ApiError(404, 'NOT_FOUND', 'Route not found');
}

async function routeContactOps(request, url, service, {
  enableDemoSessionReset = false,
  voiceAudioUploader = null,
  threeTierService = null,
  liveCallService = null,
} = {}) {
  if (url.pathname.startsWith(THREE_TIER_PREFIX)) {
    return routeThreeTier(request, url, threeTierService);
  }
  const readSession = () => sessionFor(request);
  if (request.method === 'POST' && url.pathname.endsWith('/live-calls')) {
    if (!liveCallService) throw new ApiError(503, 'LIVE_CALL_UNAVAILABLE', '실시간 통화를 사용할 수 없습니다.');
    if (!/^application\/json(?:;|$)/i.test(String(request.headers['content-type'] || ''))) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
    const body = await readBody(request);
    exactBody(body, ['expected_revision']);
    return liveCallService.createCall({
      sessionId: sessionFor(request, { required: true }),
      caseId: caseIdFrom(url.pathname, '/live-calls'),
      expectedRevision: body.expected_revision,
    });
  }
  if (!service) throw new ApiError(503, 'CONTACT_OPS_UNAVAILABLE', 'ContactOps state is unavailable');
  if (request.method === 'GET' && url.pathname === '/api/v1/contact-ops/today') {
    assertKnownQuery(url.searchParams, new Set(['referenceDate', 'workerId']));
    const referenceDate = url.searchParams.get('referenceDate');
    try { assertIsoDateValue(referenceDate, 'referenceDate'); } catch { throw new ApiError(400, 'INVALID_QUERY', 'referenceDate must be a valid ISO date'); }
    const workerId = url.searchParams.get('workerId');
    if (workerId !== null && !WORKER_ID_PATTERN.test(workerId)) throw new ApiError(400, 'INVALID_QUERY', 'workerId must be synthetic');
    return service.getToday({ sessionId: readSession(), referenceDate, workerId });
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/contact-ops/visit-recommendations') {
    assertKnownQuery(url.searchParams, new Set(['district']));
    return service.getVisitRecommendations({ sessionId: readSession(), district: url.searchParams.get('district') });
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/contact-ops/manager-breadth') {
    assertKnownQuery(url.searchParams, new Set());
    return service.getManagerBreadth({ sessionId: readSession() });
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/contact-ops/operations-map') {
    assertKnownQuery(url.searchParams, new Set());
    return service.getOperationsMap({ sessionId: readSession() });
  }
  if (request.method === 'GET' && url.pathname.startsWith('/api/v1/contact-ops/cases/')) return service.getCase({ sessionId: readSession(), caseId: caseIdFrom(url.pathname) });
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'ContactOps supports GET, POST, and OPTIONS');
  if (url.pathname.endsWith('/ai-observations/audio')) {
    if (typeof voiceAudioUploader !== 'function') {
      throw new ApiError(503, 'CONTACT_OPS_UNAVAILABLE', 'Voice upload is unavailable');
    }
    assertKnownQuery(url.searchParams, new Set());
    const sessionId = sessionFor(request, { required: true });
    const caseId = caseIdFrom(url.pathname, '/ai-observations/audio');
    const staged = await voiceAudioUploader(request);
    try {
      return await service.createAiObservation({
        mode: 'candidate',
        sessionId,
        caseId,
        expectedRevision: staged.expectedRevision,
        contactDate: staged.contactDate,
        surveyorId: staged.surveyorId,
        source: { kind: 'audio', fileReference: staged.fileReference },
      });
    } finally {
      await staged.cleanup();
    }
  }
  if (!/^application\/json(?:;|$)/i.test(String(request.headers['content-type'] || ''))) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  const sessionId = sessionFor(request, { required: true }); const body = await readBody(request);
  if (url.pathname === '/api/v1/contact-ops/session-reset') {
    if (!enableDemoSessionReset) throw new ApiError(404, 'NOT_FOUND', 'Route not found');
    exactBody(body, ['expected_marker']);
    if (body.expected_marker !== '[합성]') throw new ApiError(400, 'INVALID_BODY', 'expected_marker must be [합성]');
    return service.resetDemoSession({ sessionId });
  }
  const mappings = [
    ['/contact-results', ['expected_revision', 'contact_date', 'contact_result', 'observations'], 'recordContactResult', (b) => { assertIsoDateValue(b.contact_date, 'contact_date'); return { expectedRevision: b.expected_revision, contactDate: b.contact_date, contactResult: b.contact_result, observations: b.observations }; }],
    ['/triage/recalculate', ['expected_revision', 'reference_date'], 'recalculateTriage', (b) => ({ expectedRevision: b.expected_revision, referenceDate: b.reference_date })],
  ];
  if (url.pathname.endsWith('/ai-observations')) {
    const caseId = caseIdFrom(url.pathname, '/ai-observations');
    if (body?.mode === 'candidate') {
      const textMode = Object.hasOwn(body, 'consented_masked_text');
      const audioMode = Object.hasOwn(body, 'validated_file_reference');
      exactBody(body, textMode
        ? ['mode', 'expected_revision', 'contact_date', 'surveyor_id', 'consented_masked_text']
        : ['mode', 'expected_revision', 'contact_date', 'surveyor_id', 'validated_file_reference']);
      assertIsoDateValue(body.contact_date, 'contact_date');
      if (!SURVEYOR_DISPLAY_ID_PATTERN.test(body.surveyor_id || '') || textMode === audioMode) {
        throw new ApiError(400, 'INVALID_BODY', 'Candidate requires one consented text or validated file reference');
      }
      if (textMode && (typeof body.consented_masked_text !== 'string'
          || body.consented_masked_text.trim() === '' || body.consented_masked_text.length > 15_000)) {
        throw new ApiError(400, 'INVALID_BODY', 'consented_masked_text is invalid');
      }
      if (audioMode && !AUDIO_FILE_REFERENCE_PATTERN.test(body.validated_file_reference || '')) {
        throw new ApiError(400, 'INVALID_BODY', 'validated_file_reference is invalid');
      }
      return service.createAiObservation({
        mode: 'candidate', sessionId, caseId, expectedRevision: body.expected_revision,
        contactDate: body.contact_date, surveyorId: body.surveyor_id,
        source: textMode
          ? { kind: 'text', text: body.consented_masked_text }
          : { kind: 'audio', fileReference: body.validated_file_reference },
      });
    }
    exactBody(body, ['mode', 'expected_revision', 'contact_date', 'confirmed', 'candidate']);
    assertIsoDateValue(body.contact_date, 'contact_date');
    if (body.mode !== 'confirm' || body.confirmed !== true) {
      throw new ApiError(400, 'INVALID_BODY', 'Explicit user confirmation is required');
    }
    return service.createAiObservation({
      mode: 'confirm', sessionId, caseId, expectedRevision: body.expected_revision,
      contactDate: body.contact_date, confirmed: body.confirmed, candidate: body.candidate,
    });
  }
  for (const [suffix, keys, method, convert] of mappings) if (url.pathname.endsWith(suffix)) {
    const caseId = caseIdFrom(url.pathname, suffix); exactBody(body, keys);
    return service[method]({ sessionId, caseId, ...convert(body) });
  }
  if (url.pathname.endsWith('/visit-decisions')) {
    const approved = body?.decision === 'approved';
    exactBody(body, approved
      ? ['expected_revision', 'decision', 'decided_by', 'decided_at', 'note', 'assigned_worker_ids']
      : ['expected_revision', 'decision', 'decided_by', 'decided_at', 'note']);
    return service.recordVisitDecision({ sessionId, caseId: caseIdFrom(url.pathname, '/visit-decisions'), expectedRevision: body.expected_revision, decision: body.decision, decidedBy: body.decided_by, decidedAt: body.decided_at, note: body.note, assignedWorkerIds: body.assigned_worker_ids });
  }
  throw new ApiError(404, 'NOT_FOUND', 'Route not found');
}
function routeRequest(store, url) {
  if (url.pathname === '/health' || url.pathname === '/healthz') {
    assertKnownQuery(url.searchParams, new Set());
    return {
      body: { apiVersion: API_VERSION, data: { status: 'ok', dataStatus: store.validation.status } },
      cacheable: false,
    };
  }
  if (url.pathname === '/api/v1/summary') {
    return { body: routeSummary(store, url), cacheable: true };
  }
  if (url.pathname === '/api/v1/zones') {
    return { body: routeZones(store, url), cacheable: true };
  }
  if (url.pathname.startsWith('/api/v1/zones/')) {
    const encodedId = url.pathname.slice('/api/v1/zones/'.length);
    if (encodedId.includes('/')) throw new ApiError(404, 'NOT_FOUND', 'Route not found');
    return { body: routeZoneDetail(store, url, encodedId), cacheable: true };
  }
  if (url.pathname === '/api/v1/facilities') {
    return { body: routeFacilities(store, url), cacheable: true };
  }
  if (url.pathname === '/api/v1/transit') {
    return { body: routeTransit(store, url), cacheable: true };
  }
  throw new ApiError(404, 'NOT_FOUND', 'Route not found');
}

export function createApiHandler({
  store,
  corsOrigins = process.env.CORS_ORIGINS || '',
  rateLimitPerMinute = Number(process.env.RATE_LIMIT_PER_MINUTE || 600),
  logger = null,
  contactOpsService = null,
  voiceAudioUploader = null,
  enableDemoSessionReset = false,
  threeTierService = null,
  liveCallService = null,
}) {
  if (!store) throw new Error('store is required');
  if (!Number.isSafeInteger(rateLimitPerMinute) || rateLimitPerMinute < 0 || rateLimitPerMinute > 100_000) {
    throw new Error('RATE_LIMIT_PER_MINUTE must be an integer between 0 and 100000');
  }
  const corsPolicy = createCorsPolicy(corsOrigins);
  const rateLimiter = new FixedWindowRateLimiter(rateLimitPerMinute);

  return async function apiHandler(request, response) {
    const startedAt = Date.now();
    const requestId = requestIdFor(request);
    const originHeader = request.headers.origin;
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    const corsAllowed = corsPolicy.allows(origin);
    const context = { requestId, origin, corsAllowed };
    let pathname = '/';

    response.once('finish', () => {
      logger?.info?.({
        timestamp: new Date().toISOString(),
        requestId,
        method: request.method,
        path: pathname,
        status: response.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });

    try {
      if ((request.url || '').length > MAX_URL_LENGTH) {
        throw new ApiError(414, 'URI_TOO_LONG', 'Request URL is too long');
      }
      const url = new URL(request.url || '/', 'http://localhost');
      pathname = url.pathname;

      if (!corsAllowed) throw new ApiError(403, 'CORS_ORIGIN_DENIED', 'Origin is not allowed');
      if (request.method === 'OPTIONS') {
        handlePreflight(request, response, context);
        return;
      }
      const isOps = pathname.startsWith('/api/v1/contact-ops');
      if ((!isOps && request.method !== 'GET') || (isOps && !['GET', 'POST'].includes(request.method))) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not allowed for this route');
      if (request.method === 'GET' && rejectBodyBearingRequest(request)) {
        throw new ApiError(413, 'REQUEST_BODY_NOT_ALLOWED', 'Request bodies are not accepted');
      }

      if (pathname.startsWith('/api/')) {
        const rate = rateLimiter.consume(clientKey(request));
        if (!rate.allowed) {
          throw new ApiError(429, 'RATE_LIMITED', 'Too many requests', {
            retryAfterSeconds: rate.retryAfterSeconds,
          });
        }
      }

      if (pathname === '/api/v1/contact-ops/live-calls/realtime-sdp') {
        if (!liveCallService) throw new ApiError(503, 'LIVE_CALL_UNAVAILABLE', '실시간 통화를 사용할 수 없습니다.');
        if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not allowed for this route');
        if (!/^application\/sdp(?:;|$)/i.test(String(request.headers['content-type'] || ''))) {
          throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/sdp');
        }
        const answer = await liveCallService.exchangeRealtimeSdp({
          participantToken: bearerToken(request),
          sdp: await readTextBody(request),
        });
        sendSdp(request, response, 201, answer, context);
        return;
      }

      const result = isOps
        ? { body: { apiVersion: API_VERSION, data: await routeContactOps(request, url, contactOpsService, { enableDemoSessionReset, voiceAudioUploader, threeTierService, liveCallService }) }, cacheable: false }
        : routeRequest(store, url);
      sendJson(request, response, 200, result.body, context, result.cacheable);
    } catch (error) {
      if (!(error instanceof ApiError) && error instanceof LiveCallError) {
        error = new ApiError(error.status, error.code, error.message);
      } else if (!(error instanceof ApiError) && error instanceof VoiceAudioUploadError) {
        error = new ApiError(error.status, error.code, error.message);
      } else if (!(error instanceof ApiError) && error?.code === 'STATE_CONFLICT') {
        error = new ApiError(409, 'STATE_CONFLICT', error.message);
      } else if (!(error instanceof ApiError) && error?.code === 'CASE_NOT_FOUND') {
        error = new ApiError(404, 'CASE_NOT_FOUND', error.message);
      } else if (!(error instanceof ApiError) && error instanceof TypeError) {
        error = new ApiError(400, 'INVALID_BODY', error.message);
      } else if (!(error instanceof ApiError) && pathname.startsWith('/api/v1/contact-ops')) {
        error = new ApiError(503, 'CONTACT_OPS_UNAVAILABLE', 'ContactOps state is unavailable');
      }
      if (!(error instanceof ApiError)) {
        logger?.error?.({
          timestamp: new Date().toISOString(),
          requestId,
          message: 'Unhandled API error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      if (!response.headersSent) sendError(request, response, error, context);
      else response.end();
    }
  };
}

export function createApiServer(options) {
  const server = createServer(createApiHandler(options));
  server.headersTimeout = 5_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1_000;
  return server;
}

export { API_VERSION, DATA_INTERPRETATION };
