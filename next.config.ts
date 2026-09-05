import type { NextConfig } from 'next';
import { securityHeaders } from './lib/security-headers';
const nextConfig: NextConfig = {
  headers: () => [{ source: '/:path*', headers: securityHeaders }],
};
export default nextConfig;
