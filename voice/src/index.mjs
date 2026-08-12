import OpenAI from 'openai';

import {
  VOICE_OUTPUT_JSON_SCHEMA,
  VoiceContractError,
  assertVoiceOutputContract,
} from './contract.mjs';
import { maskPii, maskPiiDeep } from './privacy.mjs';
import { VOICE_EXTRACTION_INSTRUCTIONS } from './prompt.mjs';

const DEFAULT_MODEL = 'gpt-4o-mini';
const SURVEYOR_ID_PATTERN = /^연결단원 [0-9]{3}$/;
const CASE_ID_PATTERN = /\bCASE-[0-9]{4,8}\b/g;
const EXPLICIT_RISK_SCORE_PATTERN = /(?:위험\s*점수|risk\s*score)\s*(?:는|은|:|=)?\s*([0-9]+)(?:\s*점)?/i;
const NEGATED_VISIT_PATTERN = /방문(?:이|은|을)?\s*(?:필요\s*(?:없|하지\s*않)|권고하지\s*않|추천하지\s*않)/;
const EXPLICIT_VISIT_PATTERN = /(?:방문(?:이|은)?\s*필요(?:해|하|합|할|했|될)|방문(?:을)?\s*(?:권고|추천)|방문해야|방문해\s*(?:주세요|주십시오))/;

export class VoiceInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VoiceInputError';
  }
}

function assertTextInput(input) {
  if (!input || input.kind !== 'text') {
    throw new VoiceInputError("3a currently supports only { kind: 'text' } input.");
  }
  if (typeof input.text !== 'string' || input.text.trim() === '') {
    throw new VoiceInputError('text must be a non-empty string.');
  }
  if (input.text.length > 20_000) {
    throw new VoiceInputError('text must not exceed 20,000 characters.');
  }
  if (!SURVEYOR_ID_PATTERN.test(input.surveyorId)) {
    throw new VoiceInputError('surveyorId must use the synthetic form 연결단원 001.');
  }
}

function extractCaseId(transcript) {
  const caseIds = [...new Set(transcript.match(CASE_ID_PATTERN) || [])];
  if (caseIds.length > 1) {
    throw new VoiceInputError('A single voice input cannot contain multiple case IDs.');
  }
  return caseIds[0] || null;
}

function createClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new VoiceInputError(
      'OPENAI_API_KEY is required in voice/.env unless a test client is injected.',
    );
  }
  return new OpenAI({ apiKey });
}

function parseModelOutput(response) {
  if (response?.status && response.status !== 'completed') {
    throw new VoiceContractError('The model response did not complete.');
  }
  if (typeof response?.output_text !== 'string' || response.output_text.trim() === '') {
    throw new VoiceContractError('The model response contained no structured output.');
  }

  try {
    return JSON.parse(response.output_text);
  } catch {
    throw new VoiceContractError('The model response was not valid JSON.');
  }
}

function extractRiskScore(transcript) {
  const match = transcript.match(EXPLICIT_RISK_SCORE_PATTERN);
  if (!match) return 0;
  const score = Number(match[1]);
  return Number.isSafeInteger(score) ? score : 0;
}

function extractVisitRecommendation(transcript) {
  if (NEGATED_VISIT_PATTERN.test(transcript)) return false;
  return EXPLICIT_VISIT_PATTERN.test(transcript);
}

function normalizeTrustedFields(value, { transcript, surveyorId, caseId }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new VoiceContractError('The model response root must be a JSON object.');
  }

  const masked = maskPiiDeep(value);
  masked.transcript = transcript;
  masked.surveyor_id = surveyorId;
  masked.case_id = masked.intent === 'contact_result' ? caseId : null;
  if (masked.intent === 'contact_result' && masked.contact_result) {
    masked.contact_result.risk_score = extractRiskScore(transcript);
    masked.contact_result.visit_recommended = extractVisitRecommendation(transcript);
  }
  return masked;
}

/**
 * Stable entry point for the voice layer. Stage 3a accepts text; later stages add
 * audio-file and realtime sources without changing the returned JSON contract.
 */
export async function processVoiceInput(input, options = {}) {
  assertTextInput(input);

  const transcript = maskPii(input.text);
  const caseId = extractCaseId(transcript);
  const client = options.client || createClient();
  const model = options.model || process.env.OPENAI_VOICE_TEXT_MODEL || DEFAULT_MODEL;

  const response = await client.responses.create({
    model,
    input: [
      { role: 'system', content: VOICE_EXTRACTION_INSTRUCTIONS },
      {
        role: 'user',
        content: JSON.stringify({
          surveyor_id: input.surveyorId,
          transcript,
        }),
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'neighbor_connector_voice_record',
        strict: true,
        schema: VOICE_OUTPUT_JSON_SCHEMA,
      },
    },
    store: false,
  });

  const parsed = parseModelOutput(response);
  const normalized = normalizeTrustedFields(parsed, {
    transcript,
    surveyorId: input.surveyorId,
    caseId,
  });
  return assertVoiceOutputContract(normalized);
}

export { VOICE_OUTPUT_JSON_SCHEMA, assertVoiceOutputContract, maskPii };
