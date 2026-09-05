import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkRequestAccess,
  checkProviderAccess,
} from '../lib/abuse-controls.ts';
const pass = { limit: async () => ({ success: true }) };
const fail = { limit: async () => ({ success: false }) };
const request = new Request('https://example.com/api/transcribe', {
  headers: { 'CF-Connecting-IP': '192.0.2.1' },
});
test('pause and missing bindings stop requests before provider processing', async () => {
  await assert.rejects(
    checkRequestAccess(request, { TRANSCRIPTION_PAUSED: 'true' }),
    { status: 503 },
  );
  await assert.rejects(checkRequestAccess(request, {}), { status: 503 });
});
test('Cloudflare IP limit denies traffic and accepts available capacity', async () => {
  await assert.rejects(
    checkRequestAccess(request, {
      IP_RATE_LIMITER: fail,
      KEY_RATE_LIMITER: pass,
    }),
    { status: 429 },
  );
  await checkRequestAccess(request, {
    IP_RATE_LIMITER: pass,
    KEY_RATE_LIMITER: pass,
  });
});
test('provider pause and per-key limits stop upstream calls without exposing keys', async () => {
  await assert.rejects(
    checkProviderAccess('meta', 'dummy-key', {
      DISABLED_PROVIDERS: ' meta,gemini ',
      KEY_RATE_LIMITER: pass,
    }),
    { status: 503 },
  );
  await assert.rejects(
    checkProviderAccess('meta', 'dummy-key', { KEY_RATE_LIMITER: fail }),
    { status: 429 },
  );
  let captured = '';
  await checkProviderAccess('meta', 'dummy-key', {
    KEY_RATE_LIMITER: {
      limit: async ({ key }) => {
        captured = key;
        return { success: true };
      },
    },
  });
  assert.match(captured, /^[a-f0-9]{64}$/);
  assert.ok(!captured.includes('dummy'));
});
