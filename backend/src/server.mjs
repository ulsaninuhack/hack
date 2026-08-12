import { createApiServer } from './app.mjs';
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

const store = await loadDataStore();
const server = createApiServer({ store, logger });

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
