import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import {
  createFirestoreLiveCallInviteStore,
  createMemoryLiveCallInviteStore,
} from '../src/live-call-invite-store.mjs';

const NOW = new Date('2026-08-13T01:00:00.000Z');
const INVITE = {
  inviteCode: 'invitecode0123456789abcdef012345',
  callId: 'call123',
  roomName: 'care-call-call123',
  expiresAt: '2026-08-13T01:30:00.000Z',
};

function fakeFirestore() {
  const records = new Map();
  return {
    records,
    collection(name) {
      return {
        doc(id) {
          return {
            id,
            async set(value) { records.set(`${name}/${id}`, structuredClone(value)); },
            async get() {
              const value = records.get(`${name}/${id}`);
              return { exists: value !== undefined, data: () => structuredClone(value) };
            },
            async delete() { records.delete(`${name}/${id}`); },
          };
        },
      };
    },
  };
}

describe('live-call invite store', () => {
  test('keeps only hashed short codes in memory and expires records', async () => {
    let now = NOW;
    const store = createMemoryLiveCallInviteStore({ now: () => now });

    await store.saveInvite(INVITE);
    assert.deepEqual(await store.getInvite({ inviteCode: INVITE.inviteCode }), {
      callId: INVITE.callId,
      roomName: INVITE.roomName,
      expiresAt: INVITE.expiresAt,
    });

    now = new Date('2026-08-13T01:31:00.000Z');
    assert.equal(await store.getInvite({ inviteCode: INVITE.inviteCode }), null);
  });

  test('persists a multi-instance-safe Firestore record without storing the bearer code', async () => {
    const firestore = fakeFirestore();
    const store = createFirestoreLiveCallInviteStore({
      firestore,
      collectionName: 'live_call_invites',
      now: () => NOW,
    });

    await store.saveInvite(INVITE);
    const expectedId = createHash('sha256').update(INVITE.inviteCode).digest('hex');
    assert.ok(firestore.records.has(`live_call_invites/${expectedId}`));
    assert.equal(JSON.stringify([...firestore.records.values()]).includes(INVITE.inviteCode), false);
    assert.deepEqual(await store.getInvite({ inviteCode: INVITE.inviteCode }), {
      callId: INVITE.callId,
      roomName: INVITE.roomName,
      expiresAt: INVITE.expiresAt,
    });
  });

  test('rejects malformed construction and invite records', async () => {
    assert.throws(() => createFirestoreLiveCallInviteStore({ firestore: {} }), /firestore/);
    assert.throws(() => createFirestoreLiveCallInviteStore({ firestore: fakeFirestore(), collectionName: 'bad\/name' }), /collection/);
    const store = createMemoryLiveCallInviteStore({ now: () => NOW });
    await assert.rejects(() => store.saveInvite({ ...INVITE, inviteCode: 'short' }), /invite/);
    await assert.rejects(() => store.saveInvite({ ...INVITE, callId: '../bad' }), /identifiers/);
    await assert.rejects(() => store.saveInvite({ ...INVITE, expiresAt: 'not-a-date' }), /expires/);
    assert.equal(await store.getInvite({ inviteCode: '../bad' }), null);

    const firestore = fakeFirestore();
    const firestoreStore = createFirestoreLiveCallInviteStore({ firestore, now: () => NOW });
    const corruptCode = 'corruptinvitecode0123456789012345';
    const corruptId = createHash('sha256').update(corruptCode).digest('hex');
    firestore.records.set(`live_call_invites/${corruptId}`, { callId: '../bad', expiresAt: INVITE.expiresAt });
    assert.equal(await firestoreStore.getInvite({ inviteCode: corruptCode }), null);
    assert.equal(firestore.records.has(`live_call_invites/${corruptId}`), false);
  });

  test('uses real clocks by default for memory and Firestore adapters', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const input = { ...INVITE, expiresAt: future };
    const memoryStore = createMemoryLiveCallInviteStore();
    await memoryStore.saveInvite(input);
    assert.equal((await memoryStore.getInvite({ inviteCode: input.inviteCode })).expiresAt, future);

    const firestore = fakeFirestore();
    const firestoreStore = createFirestoreLiveCallInviteStore({ firestore });
    await firestoreStore.saveInvite(input);
    assert.equal((await firestoreStore.getInvite({ inviteCode: input.inviteCode })).expiresAt, future);
  });
});
