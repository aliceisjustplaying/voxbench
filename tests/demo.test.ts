import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  validateDemo,
  claimTrial,
  remainingTrials,
  trialIdentity,
  verifyHuman,
  checkDemoBudget,
} from '../lib/demo.ts';
function wav(seconds: number) {
  const bytes = Buffer.alloc(44 + seconds * 32000);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes.toString('base64');
}
const key = 'test-only-server-key';
const raw = {
  audio: wav(1),
  vocabulary: ['Voxbench'],
  english: true,
  token: 'test-token',
};
test('free request pins the server key/model and rejects audio over 30 seconds', () => {
  const { input } = validateDemo(
    { ...raw, id: 'expensive-model', key: 'attacker-key', connection: 'other' },
    key,
  );
  assert.equal(input.key, key);
  assert.equal(input.id, 'gpt');
  assert.equal(input.connection, 'openrouter');
  assert.throws(
    () => validateDemo({ ...raw, audio: wav(31) }, key),
    /30 seconds/,
  );
  assert.throws(() => validateDemo({ ...raw, token: '' }, key), /verification/);
  assert.throws(() => validateDemo({ ...raw, audio: 'not-wav' }, key));
});
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    readFileSync(
      new URL('../migrations/0001_demo_quota.sql', import.meta.url),
      'utf8',
    ),
  );
  const adapter = {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => ({
        first: async () =>
          sqlite.prepare(sql).get(...(values as (string | number)[])) ?? null,
      }),
    }),
  };
  return { sqlite, db: adapter as unknown as D1Database };
}
test('atomic quota admits only three simultaneous claims from one browser', async () => {
  const { db, sqlite } = database();
  try {
    const r = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        claimTrial(db, 'same-browser', 'same-network'),
      ),
    );
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 3);
    assert.equal(await remainingTrials(db, 'same-browser'), 0);
    assert.equal(
      sqlite.prepare('SELECT count(*) AS n FROM demo_claims').get()?.n,
      3,
    );
  } finally {
    sqlite.close();
  }
});
test('clearing cookies cannot exceed ten trial claims per network per day', async () => {
  const { db, sqlite } = database();
  try {
    const r = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        claimTrial(db, 'browser-' + i, 'same-network-day'),
      ),
    );
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 10);
    await claimTrial(db, 'new-browser', 'other-network-day');
  } finally {
    sqlite.close();
  }
});
test('signed visitor cookies survive normal use and reject forged IDs', async () => {
  const request = (cookie = '') =>
    new Request('https://voxbench.test/api/demo', {
      headers: { cookie, 'CF-Connecting-IP': '192.0.2.1' },
    });
  const first = await trialIdentity(request(), key);
  const again = await trialIdentity(request(first.cookie), key);
  assert.equal(first.visitor, again.visitor);
  assert.equal(first.network, again.network);
  const forged = await trialIdentity(
    request(first.cookie.replace(first.visitor, crypto.randomUUID())),
    key,
  );
  assert.notEqual(forged.visitor, first.visitor);
  assert.equal(forged.network, first.network);
  assert.ok(!first.network.includes('192.0.2.1'));
});
test('verification must succeed for this hostname and demo action', async () => {
  const r = new Request('https://voxbench.test/api/demo');
  for (const data of [
    { success: false },
    { success: true, hostname: 'attacker.test', action: 'voxbench-demo' },
    { success: true, hostname: 'voxbench.test', action: 'other' },
  ]) {
    await assert.rejects(
      verifyHuman('token', r, 'secret', async () => Response.json(data)),
      /Verification/,
    );
  }
  await verifyHuman('token', r, 'secret', async () =>
    Response.json({
      success: true,
      hostname: 'voxbench.test',
      action: 'voxbench-demo',
    }),
  );
});
test('demo refuses unlimited/renewing keys and depleted budgets', async () => {
  for (const data of [
    { limit: null, limit_reset: null, limit_remaining: 100 },
    { limit: 101, limit_reset: null, limit_remaining: 100 },
    { limit: 100, limit_reset: 'daily', limit_remaining: 100 },
    { limit: 100, limit_reset: null, limit_remaining: 0 },
  ]) {
    await assert.rejects(
      checkDemoBudget(key, async () => Response.json({ data })),
    );
  }
  await checkDemoBudget(key, async () =>
    Response.json({
      data: { limit: 100, limit_reset: null, limit_remaining: 99 },
    }),
  );
});
