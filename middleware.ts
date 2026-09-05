import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, securityHeaders } from './lib/security-headers';
export function middleware(request: NextRequest) {
  const nonce = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))),
  );
  const policy = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV !== 'production',
  );
  const headers = new Headers(request.headers);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers } });
  for (const { key, value } of securityHeaders)
    response.headers.set(key, value);
  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = { matcher: ['/', '/connect/:path*', '/privacy'] };
