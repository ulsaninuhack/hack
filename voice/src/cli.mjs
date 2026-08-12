import { processVoiceInput, maskPii } from './index.mjs';

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write(
      'Usage: npm run text -- --surveyor-id "연결단원 001" [--text "합성 발화"]\n'
      + 'If --text is omitted, the transcript is read from stdin.\n',
    );
    return;
  }

  const surveyorId = readOption('--surveyor-id') || '연결단원 001';
  const argumentText = readOption('--text');
  const text = argumentText === null ? await readStdin() : argumentText;
  const result = await processVoiceInput({ kind: 'text', text, surveyorId });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  const expectedError = ['VoiceInputError', 'VoiceContractError'].includes(error?.name);
  const message = expectedError ? maskPii(error.message) : 'OpenAI request failed.';
  process.stderr.write(`Voice input conversion failed: ${message}\n`);
  process.exitCode = 1;
});
