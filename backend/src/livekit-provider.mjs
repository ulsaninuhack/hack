import { LiveCallError } from './live-call-service.mjs';

const URL_SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{3,80}$/;

function assertConfig({ serverUrl, apiKey, apiSecret }) {
  let parsed;
  try { parsed = new URL(serverUrl); } catch { throw new Error('LIVEKIT_URL must be a valid URL'); }
  if (!['wss:', 'ws:'].includes(parsed.protocol)) throw new Error('LIVEKIT_URL must use wss or ws');
  if (typeof apiKey !== 'string' || apiKey.length < 3) throw new Error('LIVEKIT_API_KEY is required');
  if (typeof apiSecret !== 'string' || apiSecret.length < 8) throw new Error('LIVEKIT_API_SECRET is required');
}

function displayName(role) {
  return role === 'surveyor' ? '연결단원' : '연락 대상';
}

function normalizeClaims(claims) {
  let metadata;
  try { metadata = JSON.parse(claims?.metadata || '{}'); } catch {
    throw new LiveCallError(401, 'LIVE_CALL_UNAUTHORIZED', '통화 참여 정보를 확인할 수 없습니다.');
  }
  const identity = claims?.sub || claims?.identity;
  const roomName = claims?.video?.room || claims?.room;
  const { role, call_id: callId, version } = metadata;
  if (version !== 1 || !['surveyor', 'resident'].includes(role)
      || !URL_SAFE_ID_PATTERN.test(callId || '')
      || identity !== `${role}-${callId}`
      || roomName !== `care-call-${callId}`
      || claims?.video?.roomJoin === false) {
    throw new LiveCallError(401, 'LIVE_CALL_UNAUTHORIZED', '통화 참여 정보를 확인할 수 없습니다.');
  }
  return { roomName, identity, role, callId };
}

export function createLiveKitTokenProvider({
  serverUrl,
  apiKey,
  apiSecret,
  tokenFactory,
  verifier,
  trackSourceMicrophone = 'microphone',
}) {
  assertConfig({ serverUrl, apiKey, apiSecret });
  if (typeof tokenFactory !== 'function' || typeof verifier?.verify !== 'function') {
    throw new TypeError('LiveKit SDK adapters are required');
  }

  return Object.freeze({
    serverUrl,

    async issueParticipant(input) {
      if (!['surveyor', 'resident'].includes(input.role)
          || input.identity !== `${input.role}-${input.callId}`
          || input.roomName !== `care-call-${input.callId}`
          || !Number.isSafeInteger(input.ttlSeconds)
          || input.ttlSeconds < 60 || input.ttlSeconds > 3_600) {
        throw new TypeError('Invalid LiveKit participant token request');
      }
      const token = tokenFactory(apiKey, apiSecret, {
        identity: input.identity,
        name: displayName(input.role),
        ttl: input.ttlSeconds,
        metadata: JSON.stringify({ version: 1, role: input.role, call_id: input.callId }),
      });
      token.addGrant({
        roomJoin: true,
        room: input.roomName,
        canPublish: true,
        canPublishData: true,
        canPublishSources: [trackSourceMicrophone],
        canSubscribe: input.canSubscribe === true,
      });
      return token.toJwt();
    },

    async verifyParticipant(participantToken) {
      try {
        return normalizeClaims(await verifier.verify(participantToken));
      } catch (error) {
        if (error instanceof LiveCallError) throw error;
        throw new LiveCallError(401, 'LIVE_CALL_UNAUTHORIZED', '통화 참여 정보를 확인할 수 없습니다.');
      }
    },
  });
}

export async function createLiveKitTokenProviderFromEnvironment(env = process.env) {
  const { AccessToken, TokenVerifier, TrackSource } = await import('livekit-server-sdk');
  const apiKey = env.LIVEKIT_API_KEY;
  const apiSecret = env.LIVEKIT_API_SECRET;
  return createLiveKitTokenProvider({
    serverUrl: env.LIVEKIT_URL,
    apiKey,
    apiSecret,
    tokenFactory: (key, secret, options) => new AccessToken(key, secret, options),
    verifier: new TokenVerifier(apiKey, apiSecret),
    trackSourceMicrophone: TrackSource.MICROPHONE,
  });
}
