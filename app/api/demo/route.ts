import { env } from 'cloudflare:workers';
import { handleDemoComparison, handleDemoStatus } from '@/lib/api-demo';
import type { DemoEnv } from '@/lib/demo';
export const GET = (request: Request) =>
  handleDemoStatus(request, env as DemoEnv);
export const POST = (request: Request) =>
  handleDemoComparison(request, env as DemoEnv);
