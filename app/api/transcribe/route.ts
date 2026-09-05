import { RequestError, transcribe, validateInput } from '@/lib/transcription';
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    return Response.json(
      { error: 'Open this comparison from the Voice Lab page.' },
      { status: 403 },
    );
  const headers = { 'Cache-Control': 'no-store' };
  try {
    if (!request.headers.get('content-type')?.includes('application/json'))
      throw new RequestError('Expected a comparison request.');
    // Bound streamed request bodies even when Content-Length is absent.
    const reader = request.body?.getReader();
    if (!reader) throw new RequestError('Missing recording.');
    const parts: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2_750_000) {
        await reader.cancel();
        throw new RequestError(
          'Recording is too large. Use a clip under 60 seconds.',
          413,
        );
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const part of parts) {
      bytes.set(part, at);
      at += part.length;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new RequestError('Invalid comparison request.');
    }
    const input = validateInput(raw);
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(150_000),
    ]);
    return Response.json(await transcribe(input, signal), { headers });
  } catch (error) {
    if (error instanceof RequestError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
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
