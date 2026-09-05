import { networkGroup } from './network.ts';
import { RequestError } from './transcription.ts';

type Limiter = {
  limit: (input: { key: string }) => Promise<{ success: boolean }>;
};
export type AbuseControls = {
  TRANSCRIPTION_PAUSED?: string;
  DISABLED_PROVIDERS?: string;
  IP_RATE_LIMITER?: Limiter;
  KEY_RATE_LIMITER?: Limiter;
};

export async function checkRequestAccess(request: Request, env: AbuseControls) {
  if (env.TRANSCRIPTION_PAUSED === 'true')
    throw new RequestError(
      'Transcription is temporarily paused. Please try again later.',
      503,
    );
  // Fail closed if a deployment is missing its Cloudflare bindings.
  if (!env.IP_RATE_LIMITER || !env.KEY_RATE_LIMITER)
    throw new RequestError('Transcription is temporarily unavailable.', 503);
  const ip = networkGroup(request.headers.get('CF-Connecting-IP') || 'local');
  if (!(await env.IP_RATE_LIMITER.limit({ key: ip })).success)
    throw new RequestError(
      'Too many requests. Wait one minute before trying again.',
      429,
    );
}

export async function checkProviderAccess(
  connection: string,
  key: string,
  env: AbuseControls,
) {
  const disabled = (env.DISABLED_PROVIDERS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase());
  if (disabled.includes(connection))
    throw new RequestError(
      'This provider is temporarily paused. Choose another provider.',
      503,
    );
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(connection + ':' + key),
  );
  const fingerprint = Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  if (!env.KEY_RATE_LIMITER)
    throw new RequestError('Transcription is temporarily unavailable.', 503);
  if (!(await env.KEY_RATE_LIMITER.limit({ key: fingerprint })).success)
    throw new RequestError(
      'Too many requests for this API key. Wait one minute before trying again.',
      429,
    );
}
