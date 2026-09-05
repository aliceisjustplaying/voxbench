import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizationRequest,
  base64url,
  validateCallback,
} from '../lib/openrouter-auth.ts';
test('OAuth uses fresh S256 PKCE and a same-origin callback with random state', async () => {
  const a = await authorizationRequest('https://voxbench.test'),
    b = await authorizationRequest('https://voxbench.test');
  const url = new URL(a.url),
    callback = new URL(url.searchParams.get('callback_url')!);
  assert.equal(url.origin, 'https://openrouter.ai');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(callback.origin, 'https://voxbench.test');
  assert.equal(callback.searchParams.get('state'), a.pending.state);
  assert.notEqual(a.pending.verifier, b.pending.verifier);
  const hash = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(a.pending.verifier),
    ),
  );
  assert.equal(url.searchParams.get('code_challenge'), base64url(hash));
  assert.ok(!a.url.includes(a.pending.verifier));
});
test('OAuth rejects expired, unsolicited and mismatched callbacks', async () => {
  const { pending } = await authorizationRequest('https://voxbench.test');
  const search = '?code=test-code&state=' + pending.state;
  assert.equal(
    validateCallback(search, JSON.stringify(pending)).code,
    'test-code',
  );
  assert.throws(() => validateCallback(search, null));
  assert.throws(() =>
    validateCallback('?code=test-code&state=other', JSON.stringify(pending)),
  );
  assert.throws(() =>
    validateCallback(search, JSON.stringify(pending), pending.created + 600001),
  );
});
