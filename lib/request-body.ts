import { RequestError } from './transcription.ts';
export async function readBoundedJson(request: Request, limit = 2_750_000) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new RequestError('Expected a comparison request.');
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError('Missing recording.');
  const parts: Uint8Array[] = [];
  let length = 0,
    expired = false;
  const timeout = setTimeout(() => {
    expired = true;
    void reader.cancel().catch(() => {});
  }, 15_000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (expired)
        throw new RequestError('Upload timed out. Please try again.', 408);
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw new RequestError('Recording is too large.', 413);
      }
      parts.push(value);
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new RequestError('Invalid comparison request.');
  }
}
