import { isDeepStrictEqual } from 'node:util';

import criticJsonSchema from '../../voice/schema/contact-ops-observation-critic.schema.json' with { type: 'json' };
import voiceOutputJsonSchema from '../../voice/schema/voice-output.schema.json' with { type: 'json' };

const SCHEMAS = Object.freeze({
  neighbor_connector_voice_record: voiceOutputJsonSchema,
  contact_ops_observation_critic: criticJsonSchema,
});

export function isAllowedSchema(name, schema) {
  return Object.hasOwn(SCHEMAS, name) && isDeepStrictEqual(schema, SCHEMAS[name]);
}

export { criticJsonSchema, voiceOutputJsonSchema };
