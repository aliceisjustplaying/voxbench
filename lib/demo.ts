import { Buffer } from 'node:buffer';
import { networkGroup } from './network.ts';
import type { AbuseControls } from './abuse-controls.ts';
import { RequestError, validateInput } from './transcription.ts';
import { wavBytes } from './wav.ts';
export const DEMO_MODELS = ['gpt', 'voxtral', 'mai'] as const;
export const DEMO_SECONDS = 30;
export const DEMO_DAILY_LIMIT = 200;
export type DemoEnv = AbuseControls & {
  DEMO_DB?: D1Database;
  DEMO_ENABLED?: string;
  DEMO_COOKIE_SECRET?: string;
  VOXBENCH_DEMO_KEY?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
};
export function demoEnabled(env: DemoEnv) {
  return (
    env.DEMO_ENABLED === 'true' &&
    env.TRANSCRIPTION_PAUSED !== 'true' &&
    !!env.VOXBENCH_DEMO_KEY &&
    !!env.DEMO_COOKIE_SECRET &&
    !!env.TURNSTILE_SECRET &&
    !!env.TURNSTILE_SITE_KEY &&
    !!env.DEMO_DB
  );
}
export function validateDemo(raw: unknown, key: string) {
  if (!raw || typeof raw !== 'object')
    throw new RequestError('Invalid trial request.');
  const r = raw as Record<string, unknown>;
  const input = validateInput({
    ...r,
    id: 'gpt',
    connection: 'openrouter',
    key,
  });
  const bytes = wavBytes(input.audio);
  const seconds = (bytes.length - 44) / 32000;
  if (seconds > DEMO_SECONDS || seconds < 0.15)
    throw new RequestError(
      'Free comparisons use recordings from 0.15 to 30 seconds. Record a shorter take.',
    );
  if (
    typeof r.token !== 'string' ||
    r.token.length < 1 ||
    r.token.length > 2048
  )
    throw new RequestError(
      'Complete the verification checkbox before comparing.',
      403,
    );
  return { input, token: r.token, bytes };
}
export async function trialIdentity(request: Request, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const sign = async (value: string) =>
    Buffer.from(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)),
    ).toString('hex');
  const saved = request.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)__Host-voxbench_trial=([^;]+)/)?.[1];
  const [id, signature] = (saved || '').split('.');
  const existing =
    /^[a-f0-9-]{36}$/.test(id || '') &&
    /^[a-f0-9]{64}$/.test(signature || '') &&
    (await crypto.subtle.verify(
      'HMAC',
      key,
      Buffer.from(signature, 'hex'),
      new TextEncoder().encode('visitor:' + id),
    ));
  const visitor = existing ? id : crypto.randomUUID();
  const signed = visitor + '.' + (await sign('visitor:' + visitor));
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip)
    throw new RequestError(
      'Could not verify the network for this free trial.',
      403,
    );
  const day = new Date().toISOString().slice(0, 10);
  const network = await sign('network:' + day + ':' + networkGroup(ip));
  return {
    visitor,
    network,
    day,
    existing,
    cookie: `__Host-voxbench_trial=${signed}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=31536000`,
  };
}
export async function remainingTrials(db: D1Database, visitor: string) {
  const row = await db
    .prepare(
      "SELECT used FROM demo_counters WHERE scope='visitor' AND identifier=?",
    )
    .bind(visitor)
    .first<{ used: number }>();
  return Math.max(0, 3 - (row?.used || 0));
}
function quotaError() {
  return new RequestError(
    'The free-trial allowance for this browser, network or day has been used. Use your own keys to continue.',
    429,
  );
}
export async function checkTrialCapacity(
  db: D1Database,
  visitor: string,
  network: string,
  day: string,
) {
  const row = await db
    .prepare(`SELECT
    COALESCE((SELECT used FROM demo_counters WHERE scope='visitor' AND identifier=?),0) AS visitor,
    COALESCE((SELECT used FROM demo_counters WHERE scope='network' AND identifier=?),0) AS network,
    COALESCE((SELECT used FROM demo_counters WHERE scope='global' AND identifier=?),0) AS total`)
    .bind(visitor, network, day)
    .first<{ visitor: number; network: number; total: number }>();
  if (
    !row ||
    row.visitor >= 3 ||
    row.network >= 10 ||
    row.total >= DEMO_DAILY_LIMIT
  )
    throw quotaError();
}
export async function claimTrial(
  db: D1Database,
  visitor: string,
  network: string,
  day = new Date().toISOString().slice(0, 10),
) {
  // The INSERT and its trigger atomically check/debit all three limits.
  const result = await db
    .prepare(`INSERT INTO demo_claims(id,visitor,network_day,created_at,global_day)
    SELECT ?,?,?,?,?
    WHERE COALESCE((SELECT used FROM demo_counters WHERE scope='visitor' AND identifier=?),0) < 3
      AND COALESCE((SELECT used FROM demo_counters WHERE scope='network' AND identifier=?),0) < 10
      AND COALESCE((SELECT used FROM demo_counters WHERE scope='global' AND identifier=?),0) < ? RETURNING id`)
    .bind(
      crypto.randomUUID(),
      visitor,
      network,
      Date.now(),
      day,
      visitor,
      network,
      day,
      DEMO_DAILY_LIMIT,
    )
    .first<{ id: string }>();
  if (!result) throw quotaError();
}
export async function verifyHuman(
  token: string,
  request: Request,
  secret: string,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: request.headers.get('CF-Connecting-IP'),
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'manual',
    },
  );
  const result = (await response.json()) as {
    success?: boolean;
    hostname?: string;
    action?: string;
  };
  if (
    !response.ok ||
    !result.success ||
    result.hostname !== new URL(request.url).hostname ||
    result.action !== 'voxbench-demo'
  )
    throw new RequestError(
      'Verification expired or failed. Please complete the checkbox again.',
      403,
    );
}
export async function checkDemoBudget(
  key: string,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: 'Bearer ' + key },
    signal: AbortSignal.timeout(10_000),
    redirect: 'manual',
  });
  const result = (await response.json()) as {
    data?: {
      limit?: number | null;
      limit_reset?: string | null;
      limit_remaining?: number | null;
    };
  };
  const d = result.data;
  // Refuse an accidentally unlimited, renewing, or oversized sponsored key.
  if (
    !response.ok ||
    !d ||
    typeof d.limit !== 'number' ||
    d.limit <= 0 ||
    d.limit > 100 ||
    d.limit_reset != null
  )
    throw new RequestError(
      'The free trial is temporarily unavailable. You can use your own OpenRouter balance.',
      503,
    );
  if (typeof d.limit_remaining !== 'number' || d.limit_remaining < 0.01)
    throw new RequestError(
      'The free-trial budget has been used. Connect OpenRouter or add your own key to continue.',
      402,
    );
}
