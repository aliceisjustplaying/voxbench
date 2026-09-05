import {
  checkRequestAccess,
  checkProviderAccess,
  type AbuseControls,
} from './abuse-controls.ts';
import {
  RequestError,
  transcribe,
  validateInput,
  prepareAudio,
} from './transcription.ts';
import { readBoundedJson } from './request-body.ts';
import { logFailure } from './logging.ts';
export async function handleTranscription(
  request: Request,
  env: AbuseControls,
  fetcher: typeof fetch = fetch,
) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    return Response.json(
      { error: 'Open this comparison from the Voxbench page.' },
      { status: 403 },
    );
  const headers = { 'Cache-Control': 'no-store' };
  let apiKey = '';
  let stage = 'request-limit';

  try {
    await checkRequestAccess(request, env);
    stage = 'request-body';
    const raw = await readBoundedJson(request);
    const input = validateInput(raw);
    apiKey = input.key;
    stage = 'audio';
    const audio = await prepareAudio(input.audio);
    stage = 'key-limit';
    await checkProviderAccess(input.connection, input.key, env);
    stage = 'provider';
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(150_000),
    ]);
    return Response.json(await transcribe(input, signal, fetcher, audio), {
      headers,
    });
  } catch (error) {
    if (error instanceof RequestError)
      return Response.json(
        { error: error.message, diagnostics: error.diagnostics },
        {
          status: error.status,
          headers: {
            ...headers,
            ...(error.status === 429 ? { 'Retry-After': '60' } : {}),
          },
        },
      );
    logFailure(stage, error, [apiKey]);
    const timedOut =
      error instanceof Error &&
      ['AbortError', 'TimeoutError'].includes(error.name);
    return Response.json(
      {
        error: timedOut
          ? 'Request stopped or timed out. A provider may still finish and charge for audio already received.'
          : 'Could not reach the provider. Check your connection and try again.',
      },
      { status: timedOut ? 504 : 502, headers },
    );
  }
}
