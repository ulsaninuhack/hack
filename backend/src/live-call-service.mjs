const CASE_ID_PATTERN = /^SYN-HH-\d{10}-\d{4}$/;
const SDP_MAX_BYTES = 64_000;
const CALL_TTL_SECONDS = 30 * 60;
const SDP_PATTERN = /^v=0(?:\r?\n|$)/;

export class LiveCallError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'LiveCallError';
    this.status = status;
    this.code = code;
  }
}

function requiredDependency(value, name) {
  if (!value) throw new TypeError(`${name} is required`);
  return value;
}

function assertCreateInput({ sessionId, caseId, expectedRevision }) {
  if (typeof sessionId !== 'string' || sessionId.length < 16) {
    throw new LiveCallError(400, 'INVALID_SESSION', '통화 세션을 확인할 수 없습니다.');
  }
  if (!CASE_ID_PATTERN.test(caseId || '')) {
    throw new LiveCallError(400, 'INVALID_CASE', '연락 대상을 확인할 수 없습니다.');
  }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new LiveCallError(400, 'INVALID_REVISION', '연락 기록 버전을 확인할 수 없습니다.');
  }
}

function assertSdpInput({ participantToken, sdp }) {
  if (typeof participantToken !== 'string' || participantToken.length < 8) {
    throw new LiveCallError(401, 'LIVE_CALL_UNAUTHORIZED', '통화 참여 정보를 확인할 수 없습니다.');
  }
  if (typeof sdp !== 'string' || !SDP_PATTERN.test(sdp) || Buffer.byteLength(sdp) > SDP_MAX_BYTES) {
    throw new LiveCallError(400, 'INVALID_SDP', '통화 연결 정보를 확인할 수 없습니다.');
  }
}

function participantIdentity(role, callId) {
  return `${role}-${callId}`;
}

function tokenRequest({ role, callId, roomName }) {
  return {
    role,
    callId,
    roomName,
    identity: participantIdentity(role, callId),
    ttlSeconds: CALL_TTL_SECONDS,
    canPublish: ['microphone', 'data'],
    canSubscribe: true,
  };
}

export function createLiveCallService({
  tokenProvider,
  realtimeBridge,
  caseAccess,
  randomId = () => crypto.randomUUID().replaceAll('-', ''),
  now = () => new Date(),
  transcriptionModel = 'gpt-live-transcribe',
  transcriptionLanguage = 'ko',
} = {}) {
  requiredDependency(tokenProvider, 'tokenProvider');
  requiredDependency(realtimeBridge, 'realtimeBridge');
  requiredDependency(caseAccess, 'caseAccess');
  if (typeof tokenProvider.issueParticipant !== 'function'
      || typeof tokenProvider.verifyParticipant !== 'function'
      || typeof tokenProvider.serverUrl !== 'string') {
    throw new TypeError('tokenProvider does not match the live-call contract');
  }
  if (typeof realtimeBridge.exchangeSdp !== 'function') {
    throw new TypeError('realtimeBridge does not match the live-call contract');
  }

  return Object.freeze({
    async createCall({ sessionId, caseId, expectedRevision }) {
      assertCreateInput({ sessionId, caseId, expectedRevision });
      await caseAccess.assertReadable({ sessionId, caseId, expectedRevision });

      const callId = randomId();
      if (typeof callId !== 'string' || !/^[A-Za-z0-9_-]{3,80}$/.test(callId)) {
        throw new Error('randomId must return an opaque URL-safe identifier');
      }
      const roomName = `care-call-${callId}`;
      const [hostToken, guestToken] = await Promise.all([
        tokenProvider.issueParticipant(tokenRequest({ role: 'surveyor', callId, roomName })),
        tokenProvider.issueParticipant(tokenRequest({ role: 'resident', callId, roomName })),
      ]);
      const expiresAt = new Date(now().getTime() + CALL_TTL_SECONDS * 1_000).toISOString();

      return {
        provider: 'livekit',
        call_id: callId,
        room_name: roomName,
        server_url: tokenProvider.serverUrl,
        expires_at: expiresAt,
        transcription: {
          provider: 'openai',
          model: transcriptionModel,
          language: transcriptionLanguage,
        },
        host: {
          role: 'surveyor',
          participant_token: hostToken,
        },
        guest: {
          role: 'resident',
          participant_token: guestToken,
        },
      };
    },

    async exchangeRealtimeSdp({ participantToken, sdp }) {
      assertSdpInput({ participantToken, sdp });
      const participant = await tokenProvider.verifyParticipant(participantToken);
      if (!participant || !['surveyor', 'resident'].includes(participant.role)
          || typeof participant.callId !== 'string') {
        throw new LiveCallError(401, 'LIVE_CALL_UNAUTHORIZED', '통화 참여 정보를 확인할 수 없습니다.');
      }
      return realtimeBridge.exchangeSdp({
        sdp,
        safetyIdentifier: `live-call:${participant.callId}:${participant.role}`,
        model: transcriptionModel,
        language: transcriptionLanguage,
      });
    },
  });
}

export { CALL_TTL_SECONDS, SDP_MAX_BYTES };
