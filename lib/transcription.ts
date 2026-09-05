import { models, type Connection } from './models.ts';

export type TranscriptionInput = {
  id: string;
  connection: Connection;
  key: string;
  audio: string;
  vocabulary: string[];
  english: boolean;
};
export type TranscriptionOutput = {
  text: string;
  model: string;
  connection: Connection;
  elapsedMs: number;
  cost: number | null;
  hints: string;
  settings: Record<string, unknown>;
  audioHash: string;
};
type Json = Record<string, any>;
type Fetcher = typeof fetch;
export class RequestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function validateInput(raw: unknown): TranscriptionInput {
  if (!raw || typeof raw !== 'object')
    throw new RequestError('Invalid comparison request.');
  const r = raw as Json,
    m = models.find((m) => m.id === r.id);
  if (!m || (r.connection !== m.connection && r.connection !== m.direct))
    throw new RequestError('Choose a supported model and connection.');
  if (
    typeof r.key !== 'string' ||
    r.key.trim().length < 8 ||
    r.key.length > 2048 ||
    /[\r\n]/.test(r.key)
  )
    throw new RequestError('Add a valid API key in Connections.');
  if (
    typeof r.audio !== 'string' ||
    r.audio.length > 2_600_000 ||
    r.audio.length < 100 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(r.audio) ||
    r.audio.length % 4
  )
    throw new RequestError('Use a WAV recording of 60 seconds or less.');
  if (
    !Array.isArray(r.vocabulary) ||
    r.vocabulary.length > 100 ||
    r.vocabulary.some(
      (s: unknown) =>
        typeof s !== 'string' ||
        s.length > 49 ||
        s.trim().split(/\s+/).length > 5 ||
        /[<>{}\[\]\\]/.test(s),
    )
  )
    throw new RequestError(
      'Use up to 100 vocabulary terms, each under 50 characters and at most five words, without brackets or backslashes.',
    );
  if (typeof r.english !== 'boolean')
    throw new RequestError('Choose English or automatic language detection.');
  return {
    id: m.id,
    connection: r.connection,
    key: r.key.trim(),
    audio: r.audio,
    vocabulary: [
      ...new Set(r.vocabulary.map((x: string) => x.trim()).filter(Boolean)),
    ] as string[],
    english: r.english,
  };
}
function wavBytes(audio: string) {
  const decoded = atob(audio);
  const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
  const v = new DataView(bytes.buffer);
  const word = (at: number, n: number) =>
    String.fromCharCode(...bytes.subarray(at, at + n));
  if (
    bytes.length < 48 ||
    word(0, 4) !== 'RIFF' ||
    word(8, 4) !== 'WAVE' ||
    word(12, 4) !== 'fmt ' ||
    word(36, 4) !== 'data' ||
    v.getUint32(16, true) !== 16 ||
    v.getUint16(20, true) !== 1 ||
    v.getUint16(22, true) !== 1 ||
    v.getUint32(24, true) !== 16000 ||
    v.getUint16(34, true) !== 16 ||
    v.getUint32(40, true) !== bytes.length - 44 ||
    v.getUint32(4, true) !== bytes.length - 8 ||
    (bytes.length - 44) % 2 ||
    bytes.length > 1_928_044
  )
    throw new RequestError(
      'Audio must be a mono 16 kHz WAV, 60 seconds or less. Record or upload it again.',
    );
  return bytes;
}
function text(value: unknown): string {
  if (typeof value !== 'string')
    throw new RequestError('The provider returned no transcript text.', 502);
  return value;
}
function safeMessage(data: Json, status: number, key: string) {
  const reason =
    status === 401 || status === 403
      ? 'Key rejected or model access unavailable'
      : status === 402
        ? 'Account needs credit'
        : status === 429
          ? 'Provider rate limit reached'
          : status >= 500
            ? 'Provider is temporarily unavailable'
            : 'Provider rejected the request';
  const detail =
    typeof data.error?.message === 'string'
      ? data.error.message
      : typeof data.detail === 'string'
        ? data.detail
        : typeof data.error === 'string'
          ? data.error
          : '';
  return `${reason} (HTTP ${status}). ${detail.replaceAll(key, '[redacted]').slice(0, 220)}`.trim();
}
export async function transcribe(
  input: TranscriptionInput,
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<TranscriptionOutput> {
  const start = Date.now(),
    m = models.find((m) => m.id === input.id)!;
  const { key, connection, vocabulary: terms, english } = input;
  const bytes = wavBytes(input.audio);
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  )
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
  const blob = new Blob([bytes], { type: 'audio/wav' });
  const model = connection === m.direct ? m.directModel! : m.model;
  let hints = terms.length
    ? 'Not sent: this connection has no vocabulary adapter.'
    : 'Off';
  let settings: Json = { language: english ? 'en' : 'auto' };
  const request = async (url: string, init: RequestInit): Promise<Json> => {
    const response = await fetcher(url, { ...init, signal, redirect: 'error' });
    let data: Json;
    try {
      data = (await response.json()) as Json;
    } catch {
      throw new RequestError(
        `Provider returned an unreadable response (HTTP ${response.status}).`,
        502,
      );
    }
    if (!response.ok)
      throw new RequestError(safeMessage(data, response.status, key), 502);
    return data;
  };
  const postJson = (
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ) =>
    request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  let transcript: string,
    cost: number | null = null;
  if (connection === 'openrouter') {
    const options: Json = {};
    if (terms.length && input.id === 'gpt') {
      options.openai = { keywords: terms };
      hints = 'Keywords sent via OpenRouter; forwarding unverified.';
    }
    if (terms.length && input.id === 'voxtral') {
      options.mistral = { context_bias: terms };
      options['mistral/eu'] = { context_bias: terms };
      hints = 'Context hints sent via OpenRouter; forwarding unverified.';
    }
    settings = {
      ...settings,
      ...(Object.keys(options).length ? { providerOptions: options } : {}),
      response_format: 'json',
    };
    const data = await postJson(
      'https://openrouter.ai/api/v1/audio/transcriptions',
      {
        model,
        input_audio: { data: input.audio, format: 'wav' },
        ...(english ? { language: 'en' } : {}),
        response_format: 'json',
        ...(Object.keys(options).length ? { provider: { options } } : {}),
      },
      { Authorization: `Bearer ${key}` },
    );
    transcript = text(data.text);
    if (
      typeof data.usage?.cost === 'number' &&
      Number.isFinite(data.usage.cost) &&
      data.usage.cost >= 0
    )
      cost = data.usage.cost;
  } else if (connection === 'meta') {
    const params: Json = {
      model,
      mode: 'PUSH_TO_TALK',
      audioEncoding: 'WAV',
      ...(english ? { languageBias: ['english'] } : {}),
      ...(terms.length ? { keywords: terms } : {}),
    };
    const boundary = 'voice-lab-' + crypto.randomUUID();
    const body = new Blob([
      `--${boundary}\r\nContent-Disposition: form-data; name="request"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(params)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="take.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
      blob,
      `\r\n--${boundary}--\r\n`,
    ]);
    const data = await request('https://api.meta.ai/v1/asr/transcribe', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    transcript = text(data.transcript);
    settings = params;
    if (terms.length) hints = 'Keyword hints sent directly.';
  } else if (connection === 'gemini') {
    const config: Json = {
      mode: { type: 'verbatim' },
      ...(english ? { language_codes: ['en-US', 'en-GB'] } : {}),
      ...(terms.length ? { custom_vocabulary: terms } : {}),
    };
    const data = await postJson(
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      {
        model,
        store: false,
        input: [{ type: 'audio', data: input.audio, mime_type: 'audio/wav' }],
        generation_config: { transcription_config: config },
      },
      { 'x-goog-api-key': key },
    );
    if (data.status !== 'completed')
      throw new RequestError(
        `Gemini did not complete the transcription (${String(data.status || 'unknown')}).`,
        502,
      );
    const parts = (data.steps || [])
      .filter((step: Json) => step.type === 'model_output')
      .flatMap((step: Json) => step.content || [])
      .filter((part: Json) => typeof part.text === 'string')
      .map((part: Json) => part.text);
    if (!parts.length)
      throw new RequestError('Gemini completed without transcript text.', 502);
    transcript = parts.join('\n');
    settings = config;
    if (terms.length) hints = 'Custom vocabulary sent directly.';
  } else if (connection === 'elevenlabs') {
    const form = new FormData();
    form.append('file', blob, 'take.wav');
    form.append('model_id', model);
    form.append('tag_audio_events', 'false');
    form.append('diarize', 'false');
    if (english) form.append('language_code', 'eng');
    for (const t of terms) form.append('keyterms', t);
    const data = await request('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: form,
    });
    transcript = text(data.text);
    settings = {
      ...settings,
      tag_audio_events: false,
      diarize: false,
      keyterms: terms,
    };
    if (terms.length)
      hints = 'Keyterms sent directly (provider surcharge applies).';
  } else if (connection === 'assemblyai') {
    const headers = { authorization: key };
    const uploaded = await request('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      body: blob,
    });
    if (typeof uploaded.upload_url !== 'string')
      throw new RequestError(
        'AssemblyAI did not return an upload reference.',
        502,
      );
    settings = {
      speech_models: [model],
      ...(english ? { language_code: 'en' } : { language_detection: true }),
      disfluencies: true,
      ...(terms.length ? { keyterms_prompt: terms } : {}),
    };
    const job = await postJson(
      'https://api.assemblyai.com/v2/transcript',
      { audio_url: uploaded.upload_url, ...settings },
      headers,
    );
    if (typeof job.id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(job.id))
      throw new RequestError('AssemblyAI did not return a job reference.', 502);
    let result = job;
    while (result.status !== 'completed' && result.status !== 'error') {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new DOMException('Cancelled', 'AbortError'));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, 1500);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      result = await request(
        `https://api.assemblyai.com/v2/transcript/${job.id}`,
        { headers },
      );
    }
    if (result.status === 'error')
      throw new RequestError(safeMessage(result, 400, key), 502);
    transcript = text(result.text);
    if (terms.length) hints = 'Keyterm hints sent directly.';
  } else if (connection === 'mistral') {
    const form = new FormData();
    form.append('file', blob, 'take.wav');
    form.append('model', model);
    if (english) form.append('language', 'en');
    for (const t of terms) form.append('context_bias', t);
    const data = await request(
      'https://api.mistral.ai/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      },
    );
    transcript = text(data.text);
    settings = { ...settings, context_bias: terms };
    if (terms.length) hints = 'Context hints sent directly.';
  } else if (connection === 'deepgram') {
    const params = new URLSearchParams({
      model: 'nova-3',
      punctuate: 'true',
      smart_format: 'false',
      ...(english ? { language: 'en' } : { detect_language: 'true' }),
    });
    for (const t of terms) params.append('keyterm', t);
    const data = await request(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' },
      body: blob,
    });
    transcript = text(
      data.results?.channels?.[0]?.alternatives?.[0]?.transcript,
    );
    settings = {
      ...settings,
      punctuate: true,
      smart_format: false,
      keyterm: terms,
    };
    if (terms.length) hints = 'Keyterm hints sent directly.';
  } else throw new RequestError('Unsupported connection.');
  return {
    text: transcript,
    model,
    connection,
    elapsedMs: Date.now() - start,
    cost,
    hints,
    settings,
    audioHash: hash,
  };
}
