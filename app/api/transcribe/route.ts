import { env } from 'cloudflare:workers';
import { handleTranscription } from '@/lib/api-transcription';
import type { AbuseControls } from '@/lib/abuse-controls';
export const POST = (request: Request) =>
  handleTranscription(request, env as AbuseControls);
