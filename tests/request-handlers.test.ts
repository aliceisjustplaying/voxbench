import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleTranscription } from '../lib/api-transcription.ts';
import { handleDemoComparison, handleDemoStatus } from '../lib/api-demo.ts';
import { readBoundedJson } from '../lib/request-body.ts';
import { readApiResponse } from '../lib/api-response.ts';
import { networkGroup } from '../lib/network.ts';
import {
  claimTrial,
  remainingTrials,
  trialIdentity,
  type DemoEnv,
} from '../lib/demo.ts';
import { wavBytes, prepareAudio, transcribe } from '../lib/transcription.ts';
import { contentSecurityPolicy } from '../lib/security-headers.ts';

function wav(seconds = 1) {
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
  return b.toString('base64');
}
const raw = {
  id: 'gpt',
  connection: 'openai' as const,
  key: 'test-only-api-key',
  audio: wav(),
  vocabulary: ['Voxbench'],
  english: true,
};
const headers = {
  'content-type': 'application/json',
  origin: 'https://voxbench.test',
  'CF-Connecting-IP': '2001:db8:1234:5678::1',
};
const request = (body: unknown = raw, changes: Record<string, string> = {}) =>
  new Request('https://voxbench.test/api/demo', {
    method: 'POST',
    headers: { ...headers, ...changes },
    body: JSON.stringify(body),
  });
function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0001_demo_quota.sql', '0002_global_quota.sql'])
    sqlite.exec(
      readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'),
    );
  const db = {
    prepare: (sql: string) => ({
      bind: (...values: (string | number)[]) => ({
        first: async () => sqlite.prepare(sql).get(...values) ?? null,
      }),
    }),
  } as unknown as D1Database;
  return { sqlite, db };
}
const limits = {
  IP_RATE_LIMITER: { limit: async () => ({ success: true }) },
  KEY_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

test('native decoder rejects noncanonical encoding and malformed WAV headers', () => {
  for (const bad of [
    raw.audio + ' ',
    raw.audio.replace('U', '_'),
    raw.audio.slice(0, -1),
    raw.audio.slice(0, 12) + '!' + raw.audio.slice(13),
  ])
    assert.throws(() => wavBytes(bad));
  const b = Buffer.from(raw.audio, 'base64');
  b.writeUInt32LE(1, 28);
  assert.throws(() => wavBytes(b.toString('base64')));
  assert.equal(wavBytes(wav(60)).length, 1920044);
});
test('prepared audio is reused without decoding or hashing per model', async (t) => {
  const prepared = await prepareAudio(raw.audio);
  t.mock.method(crypto.subtle, 'digest', () => {
    throw new Error('Unexpected second hash');
  });
  for (const id of ['gpt', 'voxtral', 'mai']) {
    const result = await transcribe(
      { ...raw, id, connection: 'openrouter' },
      new AbortController().signal,
      async () => Response.json({ text: 'Voxbench' }),
      prepared,
    );
    assert.equal(result.audioHash, prepared.hash);
  }
});
test('body reader bounds chunked uploads, handles invalid JSON and times out', async (t) => {
  await assert.rejects(readBoundedJson(request(), 5), /too large/);
  await assert.rejects(
    readBoundedJson(
      new Request('https://voxbench.test', {
        method: 'POST',
        headers,
        body: '{',
      }),
    ),
    /Invalid comparison/,
  );
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stream = new ReadableStream<Uint8Array>({ start() {} });
  const pending = readBoundedJson(
    new Request('https://voxbench.test', {
      method: 'POST',
      headers,
      body: stream,
      duplex: 'half',
    } as RequestInit),
  );
  t.mock.timers.tick(15000);
  await assert.rejects(pending, /timed out/);
});
test('HTML platform errors get a readable client message', async () => {
  await assert.rejects(
    readApiResponse(new Response('<html>1102</html>', { status: 500 })),
    /unreadable response \(HTTP 500\)/,
  );
});
test('own-key route allows scripted callers but denies cross-origin browsers and invalid WAV before key limits', async () => {
  let keyChecks = 0,
    upstream = 0;
  const config = {
    ...limits,
    KEY_RATE_LIMITER: {
      limit: async () => {
        keyChecks++;
        return { success: true };
      },
    },
  };
  const fetcher: typeof fetch = async () => {
    upstream++;
    return Response.json({ text: 'Voxbench' });
  };
  assert.equal(
    (
      await handleTranscription(
        request(raw, { origin: 'https://other.test' }),
        config,
        fetcher,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleTranscription(
        request({ ...raw, audio: Buffer.alloc(100).toString('base64') }),
        config,
        fetcher,
      )
    ).status,
    400,
  );
  assert.equal(keyChecks, 0);
  assert.equal(upstream, 0);
  const scripted = request();
  scripted.headers.delete('origin');
  assert.equal(
    (await handleTranscription(scripted, config, fetcher)).status,
    200,
  );
  assert.equal(keyChecks, 1);
  assert.equal(upstream, 1);
});
test('IPv6 rotation shares /64 quotas; another subnet and IPv4 stay distinct', async () => {
  assert.equal(
    networkGroup('2001:db8:1234:5678::1'),
    networkGroup('2001:0DB8:1234:5678:abcd:0:0:2'),
  );
  assert.notEqual(
    networkGroup('2001:db8:1234:5678::1'),
    networkGroup('2001:db8:1234:5679::1'),
  );
  assert.equal(networkGroup('192.0.2.1'), '192.0.2.1');
  const a = await trialIdentity(request(), 'cookie-secret');
  const b = await trialIdentity(
    request(raw, { 'CF-Connecting-IP': '2001:db8:1234:5678::f' }),
    'cookie-secret',
  );
  assert.equal(a.network, b.network);
});
test('global daily limit is atomic across different browsers and networks and rolls over by day', async () => {
  const { db, sqlite } = database();
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 240 }, (_, i) =>
        claimTrial(db, 'visitor-' + i, 'network-' + i, '2026-09-05'),
      ),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 200);
    await claimTrial(db, 'tomorrow', 'tomorrow', '2026-09-06');
    assert.equal(await remainingTrials(db, 'visitor-0'), 2);
  } finally {
    sqlite.close();
  }
});
test('cleanup drops expired daily data while preserving lifetime visitor quota', async () => {
  const { db, sqlite } = database();
  try {
    await claimTrial(db, 'old-visitor', 'old-network');
    sqlite.prepare('UPDATE demo_claims SET created_at=0').run();
    sqlite
      .prepare("UPDATE demo_counters SET expires_at=1 WHERE scope!='visitor'")
      .run();
    await claimTrial(db, 'new-visitor', 'new-network');
    assert.equal(
      sqlite.prepare('SELECT count(*) as n FROM demo_claims').get()?.n,
      1,
    );
    assert.equal(await remainingTrials(db, 'old-visitor'), 2);
  } finally {
    sqlite.close();
  }
});
test('demo status sets no cookie; verified comparison uses fixed trio, quota and separate cookie secret', async () => {
  const { db, sqlite } = database();
  const config: DemoEnv = {
    ...limits,
    DEMO_DB: db,
    DEMO_ENABLED: 'true',
    VOXBENCH_DEMO_KEY: 'billing-secret-one',
    DEMO_COOKIE_SECRET: 'independent-cookie-secret',
    TURNSTILE_SECRET: 'turnstile-secret',
    TURNSTILE_SITE_KEY: 'public-site-key',
  };
  let providerCalls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    if (url === 'https://openrouter.ai/api/v1/key')
      return Response.json({
        data: { limit: 100, limit_reset: null, limit_remaining: 99 },
      });
    if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify')
      return Response.json({
        success: true,
        hostname: 'voxbench.test',
        action: 'voxbench-demo',
      });
    providerCalls++;
    const body = JSON.parse(init!.body as string) as { model: string };
    assert.ok(
      [
        'openai/gpt-transcribe',
        'mistralai/voxtral-mini-transcribe',
        'microsoft/mai-transcribe-2',
      ].includes(body.model),
    );
    return Response.json({ text: 'Voxbench' });
  };
  try {
    const status = await handleDemoStatus(request(), config);
    assert.equal(status.headers.get('set-cookie'), null);
    const noOrigin = request({ ...raw, token: 'valid-token' });
    noOrigin.headers.delete('origin');
    assert.equal(
      (await handleDemoComparison(noOrigin, config, fetcher)).status,
      403,
    );
    const response = await handleDemoComparison(
      request({ ...raw, token: 'valid-token' }),
      config,
      fetcher,
    );
    assert.equal(response.status, 200);
    assert.equal(providerCalls, 3);
    const cookie = response.headers.get('set-cookie')!;
    assert.ok(cookie);
    const statusAfterRotation = await handleDemoStatus(
      request(raw, { cookie }),
      { ...config, VOXBENCH_DEMO_KEY: 'billing-secret-two' },
    );
    assert.equal(
      ((await statusAfterRotation.json()) as { remaining: number }).remaining,
      2,
    );
  } finally {
    sqlite.close();
  }
});
test('production CSP requires a nonce for inline scripts and excludes unsafe evaluation', () => {
  const policy = contentSecurityPolicy('test-nonce');
  assert.match(policy, /script-src 'self' 'nonce-test-nonce'/);
  assert.doesNotMatch(policy, /unsafe-eval/);
  assert.match(policy, /frame-ancestors 'none'/);
});

test('AssemblyAI polling stops at 40 checks rather than exceeding the Worker subrequest limit', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return calls === 1
      ? Response.json({ upload_url: 'https://cdn.assemblyai.com/test' })
      : Response.json({ id: 'job', status: 'processing' });
  };
  const done = assert.rejects(
    transcribe(
      { ...raw, id: 'assembly', connection: 'assemblyai' },
      new AbortController().signal,
      fetcher,
    ),
    /40 checks/,
  );
  for (let n = 0; n < 42; n++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    t.mock.timers.tick(1500);
  }
  await done;
  assert.equal(calls, 42);
});

test('missing provider limiter is unavailable, not a user rate-limit error', async () => {
  const { checkProviderAccess } = await import('../lib/abuse-controls.ts');
  await assert.rejects(checkProviderAccess('openai', 'test-key', {}), {
    status: 503,
  });
});
