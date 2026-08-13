import { createApiServer } from './app.mjs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createContactOpsAiRuntime } from './contact-ops-ai-runtime.mjs';
import { createContactOpsService } from './contact-ops-service.mjs';
import { createFirestoreContactOpsState, createMemoryContactOpsState } from './contact-ops-state.mjs';
import { loadDataStore } from './data-store.mjs';

const port = Number(process.env.PORT || 8080);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const logger = {
  info(entry) {
    process.stdout.write(`${JSON.stringify({ severity: 'INFO', ...entry })}\n`);
  },
  error(entry) {
    process.stderr.write(`${JSON.stringify({ severity: 'ERROR', ...entry })}\n`);
  },
};

async function loadSyntheticHouseholds() {
  const directory = process.env.DATA_DIR || new URL('../../public/data/', import.meta.url);
  const path = directory instanceof URL ? new URL('synthetic-households.json', directory) : `${directory}/synthetic-households.json`;
  const dataset = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(dataset.households) || dataset.synthetic !== true
      || typeof dataset.scenario_reference_date !== 'string'
      || dataset.households.some((household) => household.synthetic !== true)) {
    throw new Error('ContactOps seed must contain synthetic households only');
  }
  return dataset;
}
async function loadStructuralContext() {
  const directory = process.env.DATA_DIR || new URL('../../public/data/', import.meta.url);
  const path = directory instanceof URL ? new URL('structural-context.json', directory) : `${directory}/structural-context.json`;
  return JSON.parse(await readFile(path, 'utf8'));
}

async function loadContactOpsState(households) {
  const backend = process.env.CONTACT_OPS_STATE_BACKEND || 'memory';
  if (backend === 'memory') return createMemoryContactOpsState({ households });
  if (backend !== 'firestore') throw new Error('CONTACT_OPS_STATE_BACKEND must be memory or firestore');
  const { Firestore } = await import('@google-cloud/firestore');
  return createFirestoreContactOpsState({
    firestore: new Firestore(), households,
    collectionName: process.env.CONTACT_OPS_FIRESTORE_COLLECTION || 'synthetic_contact_ops_sessions',
  });
}

const store = await loadDataStore();
let contactOpsAiRuntime;
async function loadContactOpsAiRuntime() {
  if (!contactOpsAiRuntime) {
    const voiceAdapter = await import('../../voice/src/contact-ops-adapter.mjs');
    contactOpsAiRuntime = createContactOpsAiRuntime({
      voiceAdapter,
      audioDirectory: process.env.VOICE_AUDIO_DIR || '/tmp/contact-ops-audio',
    });
  }
  return contactOpsAiRuntime;
}
const aiAdapter = Object.freeze({
  async planContactOpsObservation(input) {
    return (await loadContactOpsAiRuntime()).planContactOpsObservation(input);
  },
  async assertContactOpsObservationCandidate(value) {
    return (await loadContactOpsAiRuntime()).assertContactOpsObservationCandidate(value);
  },
});
let tuningReport;
async function loadTuningReport() {
  if (tuningReport) return structuredClone(tuningReport);
  const result = spawnSync(process.execPath, ['scripts/report-contact-triage.mjs'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', env: process.env,
  });
  if (result.error || result.status !== 0) throw new Error('Canonical synthetic tuning report is unavailable');
  tuningReport = JSON.parse(result.stdout);
  return structuredClone(tuningReport);
}
const syntheticDataset = await loadSyntheticHouseholds();
const contactOpsService = createContactOpsService({
  state: await loadContactOpsState(syntheticDataset.households),
  aiAdapter,
  loadTuningReport,
  structuralContext: await loadStructuralContext(),
  scenarioReferenceDate: syntheticDataset.scenario_reference_date,
});
const server = createApiServer({
  store,
  logger,
  contactOpsService,
  enableDemoSessionReset: process.env.CONTACT_OPS_ENABLE_TEST_RESET === '1',
});

server.listen(port, '0.0.0.0', () => {
  logger.info({
    timestamp: new Date().toISOString(),
    message: 'API server listening',
    port,
    zones: store.zones.features.length,
    facilities: store.facilities.features.length,
    transitStops: store.transit.features.length,
  });
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ timestamp: new Date().toISOString(), message: 'Graceful shutdown started', signal });
  const forceTimer = setTimeout(() => process.exit(1), 10_000);
  forceTimer.unref();
  server.close((error) => {
    clearTimeout(forceTimer);
    if (error) {
      logger.error({ timestamp: new Date().toISOString(), message: 'Graceful shutdown failed', error: error.message });
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
