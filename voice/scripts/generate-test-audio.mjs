import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sampleRate = 16_000;
const durationSeconds = 0.1;
const sampleCount = Math.round(sampleRate * durationSeconds);

function createWave(frequency) {
  const pcmBytes = sampleCount * 2;
  const buffer = Buffer.alloc(44 + pcmBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + pcmBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(pcmBytes, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 1000);
    buffer.writeInt16LE(sample, 44 + (index * 2));
  }
  return buffer;
}

const outputDirectory = fileURLToPath(
  new URL('../test/fixtures/audio/', import.meta.url),
);
await mkdir(outputDirectory, { recursive: true });

for (let index = 1; index <= 8; index += 1) {
  const filename = `case-${String(index).padStart(2, '0')}.wav`;
  await writeFile(join(outputDirectory, filename), createWave(300 + (index * 20)));
}

process.stdout.write('Generated 8 deterministic mock WAV fixtures.\n');
