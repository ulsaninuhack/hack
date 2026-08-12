import Ajv from 'ajv';

import voiceOutputJsonSchema from '../schema/voice-output.schema.json' with { type: 'json' };

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: true });
const validateJsonSchema = ajv.compile(voiceOutputJsonSchema);

export const VOICE_OUTPUT_JSON_SCHEMA = voiceOutputJsonSchema;

export class VoiceContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VoiceContractError';
  }
}

function schemaErrorSummary(errors) {
  return (errors || [])
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

export function assertVoiceOutputContract(value) {
  if (!validateJsonSchema(value)) {
    throw new VoiceContractError(
      `Voice output failed the JSON contract: ${schemaErrorSummary(validateJsonSchema.errors)}`,
    );
  }

  const validIntentPayload = (
    value.intent === 'condition'
      && value.condition !== null
      && value.contact_result === null
      && value.case_id === null
  ) || (
    value.intent === 'contact_result'
      && value.condition === null
      && value.contact_result !== null
  ) || (
    value.intent === 'other'
      && value.condition === null
      && value.contact_result === null
      && value.case_id === null
  );

  if (!validIntentPayload) {
    throw new VoiceContractError(
      'Voice output intent must populate only its matching payload; condition and other cannot carry case_id.',
    );
  }

  if (
    value.intent === 'contact_result'
    && value.contact_result.evidence.some((evidence) => !value.transcript.includes(evidence))
  ) {
    throw new VoiceContractError(
      'Every contact_result evidence item must be an exact excerpt of transcript.',
    );
  }

  return value;
}
