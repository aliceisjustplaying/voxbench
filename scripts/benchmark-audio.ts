import { prepareAudio, validateInput } from '../lib/transcription.ts';
import { wavBytes } from '../lib/wav.ts';
const iterations = 20;
for (const seconds of [30, 60]) {
  const b = Buffer.alloc(44 + seconds * 32000);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(b.length - 44, 40);
  const encoded = b.toString('base64'),
    payload = JSON.stringify({
      id: 'gpt',
      connection: 'openrouter',
      key: 'benchmark-only-key',
      audio: encoded,
      vocabulary: [],
      english: true,
    });
  for (let n = 0; n < 3; n++) await prepareAudio(wavBytes(encoded));
  const decodeStart = performance.now();
  for (let n = 0; n < iterations; n++) wavBytes(encoded);
  const decodeMs = (performance.now() - decodeStart) / iterations;
  const start = performance.now();
  for (let n = 0; n < iterations; n++) {
    const input = validateInput(JSON.parse(payload));
    await prepareAudio(wavBytes(input.audio));
    JSON.stringify({
      model: 'openai/gpt-transcribe',
      input_audio: { data: input.audio, format: 'wav' },
    });
  }
  console.log(
    JSON.stringify({
      seconds,
      decodeMs,
      totalPathMs: (performance.now() - start) / iterations,
      environment:
        'Local indicative timing; verify deployed Workers cpuTime separately',
    }),
  );
}
