const CASE_ID_PATTERN = /^SYN-HH-\d{10}-\d{4}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_KEYS = [
  'schemaVersion',
  'synthetic',
  'session_id',
  'revision',
  'household',
  'observations',
  'triage',
  'updated_at',
];

export class ContactOpsStateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function assertSyntheticHousehold(household) {
  if (!household || typeof household !== 'object' || Array.isArray(household)
      || household.synthetic !== true || !CASE_ID_PATTERN.test(household.id || '')) {
    throw new TypeError('ContactOps state accepts synthetic SYN-HH case records only');
  }
}

function assertKey({ sessionId, caseId }) {
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new TypeError('sessionId must be a bounded opaque demo session identifier');
  }
  if (typeof caseId !== 'string' || !CASE_ID_PATTERN.test(caseId)) {
    throw new TypeError('caseId must be a synthetic SYN-HH identifier');
  }
}

function clone(value) {
  return structuredClone(value);
}

function initialRecord(sessionId, household, baseline = null) {
  if (baseline !== null) {
    return {
      schemaVersion: 1,
      synthetic: true,
      session_id: sessionId,
      revision: baseline.revision,
      household: clone(baseline.household),
      observations: clone(baseline.observations),
      triage: clone(baseline.triage),
      updated_at: baseline.updated_at,
    };
  }
  return {
    schemaVersion: 1,
    synthetic: true,
    session_id: sessionId,
    revision: 0,
    household: clone(household),
    observations: {
      관찰_6징후: { 우편물_고지서_적체: false, 악취_벌레: false, 쓰레기_술병: false, 인기척_없이_TV_불: false, 외출_없음: false, 연락_두절: false },
      식사상태: null, 위생상태: null, 공과금_2개월_이상_체납: null,
      최근_건강_정신_괴로움: null, 관계망_유무: null, 연락_빈도: null,
    },
    triage: null,
    updated_at: new Date().toISOString(),
  };
}

function buildBaselines(initialRecords, seeds) {
  if (!Array.isArray(initialRecords)) throw new TypeError('initialRecords must be an array');
  const baselines = new Map();
  for (const record of initialRecords) {
    const household = record?.household;
    assertSyntheticHousehold(household);
    if (!seeds.has(household.id)) {
      throw new TypeError(`initial record case is not present in households: ${household.id}`);
    }
    if (baselines.has(household.id)) {
      throw new TypeError(`duplicate initial record case ID: ${household.id}`);
    }
    if (!Number.isSafeInteger(record.revision) || record.revision < 0
        || !record.observations || typeof record.observations !== 'object' || Array.isArray(record.observations)
        || !(record.triage === null || (typeof record.triage === 'object' && !Array.isArray(record.triage)))
        || typeof record.updated_at !== 'string' || Number.isNaN(Date.parse(record.updated_at))) {
      throw new TypeError('initial record must contain a valid revision, observations, triage, and updated_at');
    }
    baselines.set(household.id, clone(record));
  }
  return baselines;
}

function transitionRecord(current, transition) {
  const next = transition(clone(current.household), clone(current));
  const candidate = next?.household ? next : { household: next };
  assertSyntheticHousehold(candidate.household);
  return {
    schemaVersion: 1,
    synthetic: true,
    session_id: current.session_id,
    revision: current.revision + 1,
    household: clone(candidate.household),
    observations: clone(candidate.observations ?? current.observations),
    triage: clone(candidate.triage ?? current.triage),
    updated_at: new Date().toISOString(),
  };
}

function assertStoredRecord(record, { sessionId, seeds }) {
  const keys = Object.keys(record || {}).sort();
  if (keys.length !== RECORD_KEYS.length
      || RECORD_KEYS.some((key) => !Object.hasOwn(record || {}, key))
      || record.schemaVersion !== 1
      || record.synthetic !== true
      || record.session_id !== sessionId
      || !Number.isSafeInteger(record.revision)
      || record.revision < 0
      || !CASE_ID_PATTERN.test(record.household?.id || '')
      || !seeds.has(record.household.id)
      || !record.observations
      || typeof record.observations !== 'object'
      || Array.isArray(record.observations)
      || !(record.triage === null || (typeof record.triage === 'object' && !Array.isArray(record.triage)))
      || typeof record.updated_at !== 'string'
      || Number.isNaN(Date.parse(record.updated_at))) {
    throw new ContactOpsStateError('STATE_INVALID', 'Firestore ContactOps override is invalid');
  }
  return record;
}

export function createMemoryContactOpsState({ households, initialRecords = [] }) {
  if (!Array.isArray(households)) throw new TypeError('households must be an array');
  const seedById = new Map();
  for (const household of households) {
    assertSyntheticHousehold(household);
    if (seedById.has(household.id)) throw new TypeError(`duplicate synthetic case ID: ${household.id}`);
    seedById.set(household.id, clone(household));
  }
  const baselines = buildBaselines(initialRecords, seedById);
  const records = new Map();
  const keyFor = ({ sessionId, caseId }) => `${sessionId}\u0000${caseId}`;

  function current(key) {
    assertKey(key);
    const mapKey = keyFor(key);
    const household = seedById.get(key.caseId);
    if (!household) throw new ContactOpsStateError('CASE_NOT_FOUND', 'Synthetic case not found');
    return records.get(mapKey) || initialRecord(key.sessionId, household, baselines.get(key.caseId) ?? null);
  }

  return Object.freeze({
    async get(key) {
      return clone(current(key));
    },
    async list({ sessionId }) {
      if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
        throw new TypeError('sessionId must be a bounded opaque demo session identifier');
      }
      return [...seedById.keys()].sort().map((caseId) => clone(current({ sessionId, caseId })));
    },
    async update(key, transition) {
      if (!Number.isSafeInteger(key?.expectedRevision) || key.expectedRevision < 0) {
        throw new TypeError('expectedRevision must be a non-negative integer');
      }
      if (typeof transition !== 'function') throw new TypeError('transition must be a function');
      const record = current(key);
      if (record.revision !== key.expectedRevision) {
        throw new ContactOpsStateError('STATE_CONFLICT', 'Synthetic case revision is stale');
      }
      const next = transitionRecord(record, transition);
      records.set(keyFor(key), next);
      return clone(next);
    },
    async resetSession({ sessionId }) {
      if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
        throw new TypeError('sessionId must be a bounded opaque demo session identifier');
      }
      let resetOverrideCount = 0;
      for (const key of [...records.keys()]) {
        if (key.startsWith(`${sessionId}\u0000`)) { records.delete(key); resetOverrideCount += 1; }
      }
      return { synthetic: true, session_id: sessionId, reset_override_count: resetOverrideCount, seed_case_count: seedById.size };
    },
  });
}

export function createFirestoreContactOpsState({ firestore, collectionName, households, initialRecords = [] }) {
  if (!firestore || typeof firestore.collection !== 'function' || typeof firestore.runTransaction !== 'function') {
    throw new TypeError('firestore must provide collection and runTransaction');
  }
  if (typeof collectionName !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(collectionName)) {
    throw new TypeError('collectionName is invalid');
  }
  const seeds = new Map();
  for (const household of households || []) {
    assertSyntheticHousehold(household);
    seeds.set(household.id, clone(household));
  }
  const baselines = buildBaselines(initialRecords, seeds);
  const document = ({ sessionId, caseId }) => {
    assertKey({ sessionId, caseId });
    return firestore.collection(collectionName).doc(`${sessionId}--${caseId}`);
  };
  const ensure = async (transaction, key) => {
    const reference = document(key);
    const snapshot = await transaction.get(reference);
    if (snapshot.exists) {
      return {
        reference,
        record: assertStoredRecord(snapshot.data(), { sessionId: key.sessionId, seeds }),
      };
    }
    const seed = seeds.get(key.caseId);
    if (!seed) throw new ContactOpsStateError('CASE_NOT_FOUND', 'Synthetic case not found');
    const record = initialRecord(key.sessionId, seed, baselines.get(key.caseId) ?? null);
    transaction.create(reference, record);
    return { reference, record };
  };

  return Object.freeze({
    async get(key) {
      const reference = document(key);
      const snapshot = await reference.get();
      if (!snapshot.exists) {
        const seed = seeds.get(key.caseId);
        if (!seed) throw new ContactOpsStateError('CASE_NOT_FOUND', 'Synthetic case not found');
        return initialRecord(key.sessionId, seed, baselines.get(key.caseId) ?? null);
      }
      return clone(assertStoredRecord(snapshot.data(), { sessionId: key.sessionId, seeds }));
    },
    async list({ sessionId }) {
      if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
        throw new TypeError('sessionId must be a bounded opaque demo session identifier');
      }
      const snapshot = await firestore.collection(collectionName).where('session_id', '==', sessionId).get();
      const overrides = new Map(snapshot.docs.map((documentSnapshot) => {
        const record = assertStoredRecord(documentSnapshot.data(), { sessionId, seeds });
        return [record.household?.id, record];
      }));
      return [...seeds.keys()].sort().map((caseId) => clone(
        overrides.get(caseId) || initialRecord(sessionId, seeds.get(caseId), baselines.get(caseId) ?? null),
      ));
    },
    async update(key, transition) {
      if (!Number.isSafeInteger(key?.expectedRevision) || key.expectedRevision < 0) {
        throw new TypeError('expectedRevision must be a non-negative integer');
      }
      if (typeof transition !== 'function') throw new TypeError('transition must be a function');
      return firestore.runTransaction(async (transaction) => {
        const { reference, record } = await ensure(transaction, key);
        if (record.revision !== key.expectedRevision) {
          throw new ContactOpsStateError('STATE_CONFLICT', 'Synthetic case revision is stale');
        }
        const next = transitionRecord(record, transition);
        transaction.set(reference, next);
        return clone(next);
      });
    },
    async resetSession({ sessionId }) {
      if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
        throw new TypeError('sessionId must be a bounded opaque demo session identifier');
      }
      const snapshot = await firestore.collection(collectionName).where('session_id', '==', sessionId).get();
      const documents = snapshot.docs || [];
      for (let index = 0; index < documents.length; index += 450) {
        const batch = firestore.batch();
        for (const documentSnapshot of documents.slice(index, index + 450)) batch.delete(documentSnapshot.ref);
        await batch.commit();
      }
      return { synthetic: true, session_id: sessionId, reset_override_count: documents.length, seed_case_count: seeds.size };
    },
  });
}

export { CASE_ID_PATTERN, SESSION_ID_PATTERN };
