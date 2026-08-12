import { AudioInputError, processAudioFile } from './audio-input.mjs';
import { maskPii } from './index.mjs';

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new AudioInputError(`${name} requires a value.`);
  return value;
}

async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write(
      'Usage: npm run audio -- --audio-file ./synthetic.wav --surveyor-id "연결단원 001"\n',
    );
    return;
  }

  const audioPath = readOption('--audio-file');
  if (!audioPath) throw new AudioInputError('--audio-file is required.');
  const surveyorId = readOption('--surveyor-id') || '연결단원 001';
  const result = await processAudioFile({ audioPath, surveyorId });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  const expectedError = [
    'AudioInputError',
    'VoiceInputError',
    'VoiceContractError',
  ].includes(error?.name);
  const message = expectedError ? maskPii(error.message) : 'OpenAI request failed.';
  process.stderr.write(`Voice audio conversion failed: ${message}\n`);
  process.exitCode = 1;
});
