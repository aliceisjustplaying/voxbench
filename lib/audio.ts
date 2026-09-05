export const MAX_SECONDS = 60;
export type Clip = {
  source: 'recording' | 'upload';
  base64: string;
  url: string;
  duration: number;
  hash: string;
  name: string;
  blob: Blob;
};
export async function prepareClip(
  source: Blob,
  name: string,
  kind: Clip['source'] = 'upload',
  expectedSeconds?: number,
): Promise<Clip> {
  if (source.size > 25 * 1024 * 1024)
    throw new Error('Choose an audio file smaller than 25 MB.');
  // Decoding must not open/close the device's live audio session between takes.
  const context = new OfflineAudioContext(1, 1, 16000);
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await source.arrayBuffer());
  } catch {
    throw new Error(
      'This browser could not read that audio. Try a WAV, MP3, M4A or WebM file.',
    );
  }
  if (kind === 'recording' && expectedSeconds !== undefined)
    validateRecordedDuration(decoded.duration, expectedSeconds);
  if (decoded.duration > MAX_SECONDS + 0.25)
    throw new Error(
      'Please use a clip of 60 seconds or less. Short takes make comparisons easier.',
    );
  if (decoded.duration < 0.15)
    throw new Error(
      'That recording is too short. Please record a little longer.',
    );
  const offline = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * 16000),
    16000,
  );
  const input = offline.createBufferSource();
  input.buffer = decoded;
  input.connect(offline.destination);
  input.start();
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);
  const buffer = new ArrayBuffer(44 + samples.length * 2),
    view = new DataView(buffer);
  const str = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
  }
  const blob = new Blob([buffer], { type: 'audio/wav' });
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)),
  )
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
  return {
    source: kind,
    base64: btoa(binary),
    blob,
    url: URL.createObjectURL(blob),
    duration: samples.length / 16000,
    hash,
    name,
  };
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Allow encoder padding/timing jitter, but never accept a substantially cut-off take. */
export function validateRecordedDuration(actual: number, expected: number) {
  if (expected >= 2 && actual < expected - Math.max(0.75, expected * 0.2))
    throw new Error(
      `Only ${actual.toFixed(1)}s of your ${expected.toFixed(1)}s recording was captured. Please record another take.`,
    );
}
