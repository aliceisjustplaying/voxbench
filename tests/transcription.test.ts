import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribe, validateInput } from '../lib/transcription.ts';
import type { TranscriptionInput } from '../lib/transcription.ts';
function audio() {
  const b = Buffer.alloc(32044);
  b.write('RIFF');
  b.writeUInt32LE(32036, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(32000, 40);
  return b;
}
const base: TranscriptionInput = {
  id: 'muse',
  connection: 'meta',
  key: 'test-key-not-real',
  audio: audio().toString('base64'),
  vocabulary: ['Codex'],
  english: true,
};
const ok = (body: unknown) => Response.json(body);
test('rejects unknown providers, oversized bodies and invalid vocabulary before networking', () => {
  assert.throws(() => validateInput({ ...base, connection: 'other' }));
  assert.throws(() => validateInput({ ...base, key: 'abc\nsecret' }));
  assert.throws(() => validateInput({ ...base, audio: 'a'.repeat(2_600_001) }));
  assert.throws(() => validateInput({ ...base, vocabulary: ['{bad}'] }));
  assert.deepEqual(validateInput(base), base);
});
test('Meta sends exact documented multipart parts and identical WAV bytes', async () => {
  const out = await transcribe(
    base,
    new AbortController().signal,
    async (url, init) => {
      assert.equal(url, 'https://api.meta.ai/v1/asr/transcribe');
      const request = new Request(String(url), init);
      assert.equal(
        request.headers.get('Authorization'),
        'Bearer test-key-not-real',
      );
      const form = await request.formData();
      assert.deepEqual(JSON.parse(String(form.get('request'))), {
        model: 'muse-voice-transcribe-1.0',
        mode: 'PUSH_TO_TALK',
        audioEncoding: 'WAV',
        languageBias: ['english'],
        keywords: ['Codex'],
      });
      assert.deepEqual(
        Buffer.from(await (form.get('audio') as File).arrayBuffer()),
        audio(),
      );
      return ok({ transcript: 'hello Codex' });
    },
  );
  assert.equal(out.text, 'hello Codex');
  assert.equal(out.audioHash.length, 64);
});
test('Gemini requests verbatim mode, includes vocabulary and rejects incomplete results', async () => {
  const input = {
    ...base,
    id: 'gemini',
    connection: 'gemini',
  } as TranscriptionInput;
  const out = await transcribe(
    input,
    new AbortController().signal,
    async (_url, init) => {
      const b = JSON.parse(String(init?.body));
      assert.equal(b.store, false);
      assert.equal(b.input[0].data, base.audio);
      assert.deepEqual(
        b.generation_config.transcription_config.custom_vocabulary,
        ['Codex'],
      );
      assert.deepEqual(b.generation_config.transcription_config.mode, {
        type: 'verbatim',
      });
      return ok({
        status: 'completed',
        steps: [
          {
            type: 'model_output',
            content: [{ type: 'text', text: 'hello Codex' }],
          },
        ],
      });
    },
  );
  assert.equal(out.text, 'hello Codex');
  await assert.rejects(
    () =>
      transcribe(input, new AbortController().signal, async () =>
        ok({ status: 'in_progress', steps: [] }),
      ),
    /did not complete/,
  );
});
test('OpenRouter passes keywords under provider options and reports actual returned cost', async () => {
  const out = await transcribe(
    { ...base, id: 'gpt', connection: 'openrouter' },
    new AbortController().signal,
    async (_url, init) => {
      const b = JSON.parse(String(init?.body));
      assert.equal(b.model, 'openai/gpt-transcribe');
      assert.equal(b.input_audio.data, base.audio);
      assert.equal(b.prompt, undefined);
      assert.deepEqual(b.provider.options.openai.keywords, ['Codex']);
      return ok({ text: 'Hi', usage: { cost: 0.001 } });
    },
  );
  assert.equal(out.cost, 0.001);
  assert.match(out.hints, /unverified/);
});
test('ElevenLabs submits multipart keyterms and identical WAV', async () => {
  await transcribe(
    { ...base, id: 'scribe', connection: 'elevenlabs' },
    new AbortController().signal,
    async (_url, init) => {
      const f = init?.body as FormData;
      assert.deepEqual(f.getAll('keyterms'), ['Codex']);
      assert.equal(f.get('model_id'), 'scribe_v2');
      assert.equal(f.get('diarize'), 'false');
      assert.deepEqual(
        Buffer.from(await (f.get('file') as File).arrayBuffer()),
        audio(),
      );
      return ok({ text: 'Hi' });
    },
  );
});
test('AssemblyAI explicitly pins the model rather than falling back to a weaker model', async () => {
  let n = 0;
  const out = await transcribe(
    { ...base, id: 'assembly', connection: 'assemblyai' },
    new AbortController().signal,
    async (_url, init) => {
      if (n++ === 0) {
        assert.deepEqual(
          Buffer.from(await (init?.body as Blob).arrayBuffer()),
          audio(),
        );
        return ok({ upload_url: 'https://cdn.assemblyai.com/test' });
      }
      const b = JSON.parse(String(init?.body));
      assert.deepEqual(b.speech_models, ['universal-3-5-pro']);
      assert.deepEqual(b.keyterms_prompt, ['Codex']);
      assert.equal(b.disfluencies, true);
      return ok({ id: 'test-job', status: 'completed', text: 'hello' });
    },
  );
  assert.equal(out.text, 'hello');
  assert.equal(n, 2);
});
test('Direct Deepgram sends provider-native vocabulary hints', async () => {
  await transcribe(
    { ...base, id: 'nova', connection: 'deepgram' },
    new AbortController().signal,
    async (url, init) => {
      const u = new URL(String(url));
      assert.deepEqual(u.searchParams.getAll('keyterm'), ['Codex']);
      assert.equal(u.searchParams.get('smart_format'), 'false');
      assert.deepEqual(
        Buffer.from(await (init?.body as Blob).arrayBuffer()),
        audio(),
      );
      return ok({
        results: { channels: [{ alternatives: [{ transcript: 'Hi' }] }] },
      });
    },
  );
});
test('unsupported vocabulary is disclosed instead of silently claiming it was applied', async () => {
  const out = await transcribe(
    { ...base, id: 'nova', connection: 'openrouter' },
    new AbortController().signal,
    async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).provider, undefined);
      return ok({ text: 'Hi' });
    },
  );
  assert.match(out.hints, /Not sent/);
});
test('does not retry paid provider errors and redacts any reflected credential', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      transcribe(base, new AbortController().signal, async () => {
        calls++;
        return Response.json(
          { error: { message: 'bad ' + base.key } },
          { status: 401 },
        );
      }),
    (e) => {
      assert.match(String(e), /Key rejected/);
      assert.doesNotMatch(String(e), /test-key-not-real/);
      return true;
    },
  );
  assert.equal(calls, 1);
});
test('malformed WAV is rejected before provider access', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      transcribe(
        { ...base, audio: Buffer.alloc(100).toString('base64') },
        new AbortController().signal,
        async () => {
          calls++;
          return ok({});
        },
      ),
    /Audio must be/,
  );
  assert.equal(calls, 0);
});

test('uses Worker-compatible redirect mode and never follows provider redirects', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      transcribe(base, new AbortController().signal, async (_url, init) => {
        calls++;
        assert.equal(init?.redirect, 'manual');
        return new Response(null, {
          status: 307,
          headers: { Location: 'https://example.com' },
        });
      }),
    /Provider redirected/,
  );
  assert.equal(calls, 1);
});

test('shows nested OpenRouter provider errors and redacts keys', async () => {
  await assert.rejects(
    () =>
      transcribe(
        { ...base, id: 'voxtral', connection: 'openrouter' },
        new AbortController().signal,
        async () =>
          Response.json(
            {
              error: {
                message: 'Provider returned error',
                metadata: {
                  raw: JSON.stringify({
                    message: 'Invalid context_bias ' + base.key,
                  }),
                },
              },
            },
            { status: 400 },
          ),
      ),
    (error) => {
      assert.match(String(error), /OpenRouter:.*Invalid context_bias/);
      assert.doesNotMatch(String(error), /test-key-not-real/);
      return true;
    },
  );
});
