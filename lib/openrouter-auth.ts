export const AUTH_PENDING = 'voxbench-openrouter-pkce-v1';
export type PendingAuth = { verifier: string; state: string; created: number };
export function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
export async function authorizationRequest(origin: string) {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ),
  );
  const callback = new URL('/connect/openrouter', origin);
  callback.searchParams.set('state', state);
  const url = new URL('https://openrouter.ai/auth');
  url.searchParams.set('callback_url', callback.href);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return { url: url.href, pending: { verifier, state, created: Date.now() } };
}
export function validateCallback(
  search: string,
  saved: string | null,
  now = Date.now(),
) {
  const query = new URLSearchParams(search);
  const pending = saved ? (JSON.parse(saved) as PendingAuth) : null;
  const code = query.get('code');
  if (
    !pending ||
    typeof pending.verifier !== 'string' ||
    pending.verifier.length < 43 ||
    !code ||
    code.length > 2048 ||
    query.get('state') !== pending.state ||
    !Number.isFinite(pending.created) ||
    now - pending.created > 600_000 ||
    now < pending.created
  ) {
    throw new Error(
      'This connection link expired or belongs to another browser. Close this window and connect again.',
    );
  }
  return {
    code,
    code_verifier: pending.verifier,
    code_challenge_method: 'S256',
  };
}
