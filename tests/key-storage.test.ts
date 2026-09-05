import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY_STORAGE, parseKeys, saveKeys } from '../lib/key-storage.ts';

test('console and 1Password JSON backups round trip without losing provider keys', () => {
  const original = { openrouter: 'test-router', meta: 'test-meta', gemini: 'test-google', elevenlabs: 'test-eleven', assemblyai: 'test-assembly', mistral: 'test-mistral', deepgram: 'test-deepgram' };
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  saveKeys(storage, parseKeys(JSON.stringify(original)));
  assert.equal(KEY_STORAGE, 'voice-lab-api-keys-backup-v1');
  assert.deepEqual(parseKeys(storage.getItem(KEY_STORAGE)!), original);
  saveKeys(storage, {});
  assert.deepEqual(parseKeys(storage.getItem(KEY_STORAGE)!), {});
});
test('malformed imports are rejected without exposing secret values', () => {
  for (const invalid of ['null', '[]', '{', '{"unknown":"secret-sentinel"}', '{"meta":123}']) {
    assert.throws(() => parseKeys(invalid), error => error instanceof Error && !error.message.includes('secret-sentinel'));
  }
});
test('storage failures and silent failed writes are surfaced', () => {
  assert.throws(() => saveKeys({ getItem: () => null, setItem: () => {} }, {meta: 'test'}));
  assert.throws(() => saveKeys({ getItem: () => null, setItem: () => { throw new Error('blocked'); } }, {meta: 'test'}));
});
