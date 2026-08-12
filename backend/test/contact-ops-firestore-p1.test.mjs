import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createFirestoreContactOpsState } from '../src/contact-ops-state.mjs';

const sessionId = 'firestore-session-01';
const household = { id: 'SYN-HH-2812551000-0001', synthetic: true, contact: {}, workflow: {} };
function fakeFirestore() {
  const records = new Map(); let queryCount = 0; let createCount = 0;
  const collection = {
    doc: (id) => ({
      id,
      get: async () => ({
        exists: records.has(id),
        data: () => structuredClone(records.get(id)),
      }),
    }),
    where: () => ({ get: async () => { queryCount += 1; return { docs: [...records.entries()].filter(([, r]) => r.session_id === sessionId).map(([id, data]) => ({ ref: { id }, data: () => structuredClone(data) })) }; } }),
  };
  return {
    collection: () => collection,
    runTransaction: async (fn) => fn({
      get: async (ref) => ({ exists: records.has(ref.id), data: () => structuredClone(records.get(ref.id)) }),
      create: (ref, value) => { createCount += 1; records.set(ref.id, structuredClone(value)); },
      set: (ref, value) => records.set(ref.id, structuredClone(value)),
    }),
    batch: () => {
      const deletes = [];
      return { delete: (ref) => deletes.push(ref.id), commit: async () => deletes.forEach((id) => records.delete(id)) };
    },
    records,
    get queryCount() { return queryCount; },
    get createCount() { return createCount; },
  };
}
describe('P1 Firestore synthetic state adapter', () => {
  test('overlays queried session overrides onto immutable seeds without one transaction per seed', async () => {
    const firestore = fakeFirestore(); const state = createFirestoreContactOpsState({ firestore, collectionName: 'synthetic_ops', households: [household] });
    const initial = await state.list({ sessionId });
    assert.equal(initial.length, 1); assert.equal(initial[0].revision, 0); assert.equal(firestore.queryCount, 1);
    const updated = await state.update({ sessionId, caseId: household.id, expectedRevision: 0 }, (current) => ({ ...current, changed: true }));
    assert.equal(updated.revision, 1); assert.deepEqual(Object.keys(firestore.records.values().next().value).sort(), ['household', 'observations', 'revision', 'schemaVersion', 'session_id', 'synthetic', 'triage', 'updated_at']);
    const overlay = await state.list({ sessionId }); assert.equal(overlay[0].revision, 1); assert.equal(firestore.queryCount, 2);
    await assert.rejects(() => state.update({ sessionId, caseId: household.id, expectedRevision: 0 }, (current) => current), (error) => error.code === 'STATE_CONFLICT');
  });
  test('reads an untouched seed without creating a Firestore document', async () => {
    const firestore = fakeFirestore();
    const state = createFirestoreContactOpsState({
      firestore,
      collectionName: 'synthetic_ops',
      households: [household],
    });

    const record = await state.get({ sessionId, caseId: household.id });

    assert.equal(record.revision, 0);
    assert.equal(firestore.createCount, 0);
    assert.equal(firestore.records.size, 0);
  });
  test('validates adapter construction and passes unavailable Firestore errors through', async () => {
    assert.throws(() => createFirestoreContactOpsState({ firestore: {}, collectionName: 'x', households: [] }), /firestore/);
    assert.throws(() => createFirestoreContactOpsState({ firestore: fakeFirestore(), collectionName: 'bad/name', households: [] }), /collection/);
    const bad = { collection() { throw new Error('offline'); }, runTransaction() {} };
    const state = createFirestoreContactOpsState({ firestore: bad, collectionName: 'ops', households: [household] });
    await assert.rejects(() => state.list({ sessionId }), /offline/);
  });
  test('rejects invalid Firestore overrides and invalid update keys', async () => {
    const firestore = fakeFirestore(); firestore.records.set('bad', { schemaVersion: 1, synthetic: false, session_id: sessionId, revision: 0, household: household });
    const state = createFirestoreContactOpsState({ firestore, collectionName: 'ops', households: [household] });
    await assert.rejects(() => state.list({ sessionId }), (error) => error.code === 'STATE_INVALID');
    const clean = createFirestoreContactOpsState({ firestore: fakeFirestore(), collectionName: 'ops', households: [household] });
    await assert.rejects(() => clean.list({ sessionId: 'bad' }), /session/);
    await assert.rejects(() => clean.get({ sessionId: 'too-short', caseId: household.id }), /session/);
    await assert.rejects(() => clean.update({ sessionId, caseId: household.id, expectedRevision: -1 }, () => household), /expected/);
    await assert.rejects(() => clean.update({ sessionId, caseId: household.id, expectedRevision: 0 }, null), /transition/);
    await assert.rejects(() => clean.get({ sessionId, caseId: 'SYN-HH-2812551000-9999' }), (error) => error.code === 'CASE_NOT_FOUND');
  });
  test('rejects stored override fields outside the frozen persistence allowlist', async () => {
    const firestore = fakeFirestore();
    const state = createFirestoreContactOpsState({
      firestore,
      collectionName: 'ops',
      households: [household],
    });
    const record = await state.update(
      { sessionId, caseId: household.id, expectedRevision: 0 },
      (current) => current,
    );
    const key = firestore.records.keys().next().value;
    firestore.records.set(key, { ...record, unexpected_secret: 'must not leak' });

    await assert.rejects(
      () => state.get({ sessionId, caseId: household.id }),
      (error) => error.code === 'STATE_INVALID',
    );
    await assert.rejects(
      () => state.list({ sessionId }),
      (error) => error.code === 'STATE_INVALID',
    );
  });
  test('resets only a queried synthetic session overlay in bounded delete batches', async () => {
    const firestore = fakeFirestore();
    const state = createFirestoreContactOpsState({ firestore, collectionName: 'ops', households: [household] });
    await state.update({ sessionId, caseId: household.id, expectedRevision: 0 }, (current) => current);
    firestore.records.set('other--case', { ...firestore.records.values().next().value, session_id: 'another-firestore-session' });
    const reset = await state.resetSession({ sessionId });
    assert.equal(reset.reset_override_count, 1); assert.equal(firestore.records.size, 1);
    const repeat = await state.resetSession({ sessionId }); assert.equal(repeat.reset_override_count, 0);
  });
});
