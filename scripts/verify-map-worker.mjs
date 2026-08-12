import { access, readFile } from 'node:fs/promises'

const workerPath = new URL('../dist/assets/maplibre-gl-worker.mjs', import.meta.url)
const sharedPath = new URL('../dist/assets/maplibre-gl-shared.mjs', import.meta.url)

await Promise.all([access(workerPath), access(sharedPath)])

const worker = await readFile(workerPath, 'utf8')
if (!worker.includes('maplibre-gl-shared.mjs')) {
  throw new Error('MapLibre worker no longer imports the emitted shared module.')
}

console.log('Verified MapLibre production worker and shared module.')
