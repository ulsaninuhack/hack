import { createHash } from 'node:crypto';

const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{24,80}$/;
const CALL_ID_PATTERN = /^[A-Za-z0-9_-]{3,80}$/;
const ROOM_NAME_PATTERN = /^care-call-[A-Za-z0-9_-]{3,80}$/;
const COLLECTION_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

function inviteDocumentId(inviteCode) {
  return createHash('sha256').update(inviteCode).digest('hex');
}

function normalizeInvite(input) {
  if (!input || !INVITE_CODE_PATTERN.test(input.inviteCode || '')) {
    throw new TypeError('inviteCode must be an opaque URL-safe invite');
  }
  if (!CALL_ID_PATTERN.test(input.callId || '') || !ROOM_NAME_PATTERN.test(input.roomName || '')) {
    throw new TypeError('invite call identifiers are invalid');
  }
  const expires = Date.parse(input.expiresAt || '');
  if (!Number.isFinite(expires)) throw new TypeError('invite expiresAt must be an ISO timestamp');
  return {
    callId: input.callId,
    roomName: input.roomName,
    expiresAt: new Date(expires).toISOString(),
  };
}

function activeInvite(value, now) {
  if (!value || typeof value !== 'object') return null;
  try {
    const normalized = normalizeInvite({ ...value, inviteCode: 'validatedinvitecode01234567890123' });
    return Date.parse(normalized.expiresAt) > now().getTime() ? normalized : null;
  } catch {
    return null;
  }
}

export function createMemoryLiveCallInviteStore({ now = () => new Date() } = {}) {
  const records = new Map();
  return Object.freeze({
    async saveInvite(input) {
      const invite = normalizeInvite(input);
      if (Date.parse(invite.expiresAt) <= now().getTime()) throw new TypeError('invite expiresAt must be in the future');
      records.set(inviteDocumentId(input.inviteCode), invite);
    },
    async getInvite({ inviteCode }) {
      if (!INVITE_CODE_PATTERN.test(inviteCode || '')) return null;
      const key = inviteDocumentId(inviteCode);
      const invite = activeInvite(records.get(key), now);
      if (!invite) records.delete(key);
      return invite ? structuredClone(invite) : null;
    },
  });
}

export function createFirestoreLiveCallInviteStore({
  firestore,
  collectionName = 'live_call_invites',
  now = () => new Date(),
} = {}) {
  if (!firestore || typeof firestore.collection !== 'function') throw new TypeError('firestore is required');
  if (!COLLECTION_PATTERN.test(collectionName || '')) throw new TypeError('collectionName must be a simple Firestore collection name');
  const collection = firestore.collection(collectionName);

  return Object.freeze({
    async saveInvite(input) {
      const invite = normalizeInvite(input);
      if (Date.parse(invite.expiresAt) <= now().getTime()) throw new TypeError('invite expiresAt must be in the future');
      await collection.doc(inviteDocumentId(input.inviteCode)).set({
        schemaVersion: 1,
        ...invite,
        createdAt: now().toISOString(),
      });
    },
    async getInvite({ inviteCode }) {
      if (!INVITE_CODE_PATTERN.test(inviteCode || '')) return null;
      const reference = collection.doc(inviteDocumentId(inviteCode));
      const snapshot = await reference.get();
      if (!snapshot.exists) return null;
      const invite = activeInvite(snapshot.data(), now);
      if (!invite) await reference.delete();
      return invite;
    },
  });
}

export { INVITE_CODE_PATTERN };
