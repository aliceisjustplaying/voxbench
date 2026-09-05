import { Buffer } from 'node:buffer';
import { RequestError, validateWav } from './transcription.ts';
/** Server-side decoder: strict, canonical base64 plus WAV header checks. */
export function wavBytes(audio: string) {
  const bytes = Buffer.from(audio, 'base64');
  // Buffer's decoder is permissive: a native round trip rejects whitespace,
  // URL-safe alphabets, bad padding and ignored characters without a JS regex.
  if (bytes.toString('base64') !== audio)
    throw new RequestError(
      'Invalid audio encoding. Record or upload it again.',
    );
  return validateWav(
    new Uint8Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ) as Uint8Array<ArrayBuffer>,
  );
}
