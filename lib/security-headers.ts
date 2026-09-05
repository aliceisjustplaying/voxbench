export function contentSecurityPolicy(nonce: string, development = false) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://p.mosphere.at https://challenges.cloudflare.com${development ? " 'unsafe-eval'" : ''}`,
    "connect-src 'self' https://openrouter.ai https://p.mosphere.at https://challenges.cloudflare.com" +
      (development ? ' ws: wss:' : ''),
    'frame-src https://challenges.cloudflare.com',
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}
export const securityHeaders = [
  { key: 'Permissions-Policy', value: 'microphone=(self), camera=()' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
];
