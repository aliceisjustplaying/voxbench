import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribe, validateInput } from '../lib/transcription.ts';
import { connectionFor, models } from '../lib/models.ts';
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
test('OpenRouter reports returned cost and discloses unavailable GPT vocabulary', async () => {
  const out = await transcribe(
    { ...base, id: 'gpt', connection: 'openrouter' },
    new AbortController().signal,
    async (_url, init) => {
      const b = JSON.parse(String(init?.body));
      assert.equal(b.model, 'openai/gpt-transcribe');
      assert.equal(b.input_audio.data, base.audio);
      assert.equal(b.prompt, undefined);
      assert.equal(b.provider, undefined);
      return ok({ text: 'Hi', usage: { cost: 0.001 } });
    },
  );
  assert.equal(out.cost, 0.001);
  assert.match(out.hints, /no custom vocabulary/);
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

test('503 diagnostics preserve provider codes and request IDs while redacting credentials', async () => {
  await assert.rejects(
    () =>
      transcribe(base, new AbortController().signal, async () =>
        Response.json(
          {
            error: {
              message: 'Backend unavailable',
              code: 'backend_unavailable',
              trace_id: 'trace-123',
            },
            api_key: base.key,
            audio: base.audio,
          },
          {
            status: 503,
            headers: {
              'x-fb-request-id': 'request-123',
              'retry-after': '60',
              'set-cookie': 'private',
            },
          },
        ),
      ),
    (error) => {
      const d = (error as any).diagnostics;
      assert.equal(d.status, 503);
      assert.equal(d.headers['x-fb-request-id'], 'request-123');
      assert.equal(d.headers['retry-after'], '60');
      assert.equal(d.headers['set-cookie'], undefined);
      assert.match(d.response, /backend_unavailable/);
      assert.doesNotMatch(JSON.stringify(d), /test-key-not-real/);
      assert.ok(!d.response.includes(base.audio));
      return true;
    },
  );
});
test('non-JSON provider failures retain readable diagnostic details', async () => {
  await assert.rejects(
    () =>
      transcribe(
        base,
        new AbortController().signal,
        async () => new Response('backend unavailable', { status: 503 }),
      ),
    (error) => {
      assert.equal((error as any).diagnostics.response, 'backend unavailable');
      return true;
    },
  );
});

test('OpenRouter only sends supported MAI vocabulary; GPT and Voxtral disclose no support', async () => {
  for (const id of ['gpt', 'voxtral', 'mai']) {
    const out = await transcribe(
      { ...base, id, connection: 'openrouter' },
      new AbortController().signal,
      async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(
          body.provider,
          id === 'mai'
            ? {
                options: {
                  azure: { phraseList: { phrases: base.vocabulary } },
                },
              }
            : undefined,
        );
        return ok({ text: 'Codex' });
      },
    );
    assert.equal(out.hints.startsWith('Not sent'), id !== 'mai');
  }
});
test('Direct OpenAI sends exact WAV, keywords and plural languages with GPT Transcribe', async () => {
  for (const english of [true, false]) {
    const out = await transcribe(
      validateInput({ ...base, id: 'gpt', connection: 'openai', english }),
      new AbortController().signal,
      async (url, init) => {
        assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
        const form = init?.body as FormData;
        assert.equal(form.get('model'), 'gpt-transcribe');
        assert.deepEqual(form.getAll('keywords[]'), base.vocabulary);
        assert.deepEqual(form.getAll('languages[]'), english ? ['en'] : []);
        assert.equal(form.get('language'), null);
        assert.deepEqual(
          Buffer.from(await (form.get('file') as Blob).arrayBuffer()),
          audio(),
        );
        return ok({ text: 'Codex' });
      },
    );
    assert.equal(out.connection, 'openai');
    assert.equal(out.hints, 'Keywords sent directly to OpenAI.');
  }
});

test('OpenAI key takes priority while an absent or empty key keeps OpenRouter', () => {
  const m = models.find((m) => m.id === 'gpt')!;
  assert.equal(
    connectionFor(m, { openai: 'direct-key', openrouter: 'router-key' }),
    'openai',
  );
  assert.equal(
    connectionFor(m, { openai: ' ', openrouter: 'router-key' }),
    'openrouter',
  );
});
