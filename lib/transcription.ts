import { Buffer } from 'node:buffer';
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
type Json = Record<string, unknown>;
type ProviderResponse = {
  error?: unknown;
  metadata?: { raw?: unknown };
  text?: unknown;
  transcript?: unknown;
  usage?: { cost?: number };
  status?: string;
  upload_url?: string;
  id?: string;
  steps?: { type?: string; content?: { text?: string }[] }[];
  results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
};
function object(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}
type Fetcher = typeof fetch;
export type ProviderDiagnostics = {
  provider: string;
  model: string;
  endpoint: string;
  status: number;
  at: string;
  headers: Record<string, string>;
  response: string;
  truncated: boolean;
};
export class RequestError extends Error {
  status: number;
  diagnostics?: ProviderDiagnostics;
  constructor(
    message: string,
    status = 400,
    diagnostics?: ProviderDiagnostics,
  ) {
    super(message);
    this.status = status;
    this.diagnostics = diagnostics;
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
        /[\r\n<>{}[\]\\]/.test(s),
    )
  )
    throw new RequestError(
      'Use up to 100 vocabulary terms, each under 50 characters and at most five words, without brackets or backslashes.',
    );
  if (typeof r.english !== 'boolean')
    throw new RequestError('Choose English or automatic language detection.');
  return {
    id: m.id,
    connection: r.connection as Connection,
    key: r.key.trim(),
    audio: r.audio,
    vocabulary: [
      ...new Set(r.vocabulary.map((x: string) => x.trim()).filter(Boolean)),
    ] as string[],
    english: r.english,
  };
}
export function wavBytes(audio: string) {
  const bytes = Buffer.from(audio, 'base64');
  // Buffer's decoder is permissive: a native round trip rejects whitespace,
  // URL-safe alphabets, bad padding and ignored characters without a JS regex.
  if (bytes.toString('base64') !== audio)
    throw new RequestError(
      'Invalid audio encoding. Record or upload it again.',
    );
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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
    v.getUint32(28, true) !== 32000 ||
    v.getUint16(32, true) !== 2 ||
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
function safeMessage(data: ProviderResponse, status: number, key: string) {
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
  const extract = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    const v = value as Json;
    const error = object(v.error);
    if (typeof error.message === 'string') return error.message;
    if (typeof v.message === 'string') return v.message;
    if (typeof v.detail === 'string') return v.detail;
    if (Array.isArray(v.detail))
      return v.detail
        .map((item: unknown) => {
          const msg = object(item).msg;
          return typeof msg === 'string' ? msg : '';
        })
        .filter(Boolean)
        .join('; ');
    return typeof v.error === 'string' ? v.error : '';
  };
  let upstream: unknown =
    object(object(data.error).metadata).raw ?? data.metadata?.raw;
  if (typeof upstream === 'string') {
    try {
      upstream = JSON.parse(upstream);
    } catch {
      /* Some providers return plain text. */
    }
  }
  const detail = [
    ...new Set([extract(data), extract(upstream)].filter(Boolean)),
  ].join(' — ');
  return `${reason} (HTTP ${status}). ${detail.replaceAll(key, '[redacted]').slice(0, 700)}`.trim();
}
export async function prepareAudio(audio: string | Uint8Array<ArrayBuffer>) {
  const bytes = typeof audio === 'string' ? wavBytes(audio) : audio;
  const hash = Buffer.from(
    await crypto.subtle.digest('SHA-256', bytes),
  ).toString('hex');
  return { bytes, hash, blob: new Blob([bytes], { type: 'audio/wav' }) };
}
export type PreparedAudio = Awaited<ReturnType<typeof prepareAudio>>;
export async function transcribe(
  input: TranscriptionInput,
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
  prepared?: PreparedAudio,
): Promise<TranscriptionOutput> {
  const start = Date.now(),
    m = models.find((m) => m.id === input.id)!;
  const { key, connection, vocabulary: terms, english } = input;
  const { hash, blob } = prepared ?? (await prepareAudio(input.audio));
  const model = connection === m.direct ? m.directModel! : m.model;
  let hints = terms.length
    ? 'Not sent: this connection has no vocabulary adapter.'
    : 'Off';
  let settings: Json = { language: english ? 'en' : 'auto' };
  const request = async (
    url: string,
    init: RequestInit,
  ): Promise<ProviderResponse> => {
    // Workers supports manual/follow, but rejects the browser's "error" mode.
    // Reject redirects ourselves so credentials never follow another URL.
    const response = await fetcher(url, {
      ...init,
      signal,
      redirect: 'manual',
    });
    if (!response.ok) {
      const raw = await response.text();
      let data: ProviderResponse = {};
      try {
        data = JSON.parse(raw) ?? {};
      } catch {
        /* Preserve non-JSON failures too. */
      }
      const redact = (value: unknown): unknown => {
        if (typeof value === 'string')
          return value
            .replaceAll(key, '[redacted]')
            .replaceAll(input.audio, '[audio omitted]')
            .replace(/[A-Za-z0-9+/=]{160,}/g, '[long encoded value omitted]');
        if (Array.isArray(value)) return value.map(redact);
        if (value && typeof value === 'object')
          return Object.fromEntries(
            Object.entries(value).map(([name, v]) => [
              name,
              /authorization|cookie|api.?key|token|audio|file|input/i.test(name)
                ? '[redacted]'
                : redact(v),
            ]),
          );
        return value;
      };
      let sanitized: string;
      try {
        sanitized = JSON.stringify(redact(JSON.parse(raw)), null, 2);
      } catch {
        sanitized = String(redact(raw));
      }
      const responseHeaders: Record<string, string> = {};
      for (const name of [
        'content-type',
        'date',
        'retry-after',
        'x-request-id',
        'request-id',
        'x-fb-request-id',
        'x-fb-trace-id',
        'x-amzn-requestid',
        'cf-ray',
        'traceparent',
      ]) {
        const value = response.headers.get(name);
        if (value) responseHeaders[name] = String(redact(value));
      }
      const diagnostics: ProviderDiagnostics = {
        provider: connection,
        model,
        endpoint: new URL(url).origin + new URL(url).pathname,
        status: response.status,
        at: new Date().toISOString(),
        headers: responseHeaders,
        response: sanitized.slice(0, 16000),
        truncated: sanitized.length > 16000,
      };
      const message =
        response.status >= 300 && response.status < 400
          ? 'Provider redirected the request. No credentials were forwarded to the redirect destination.'
          : safeMessage(data, response.status, key);
      throw new RequestError(
        `${connection === 'openrouter' ? 'OpenRouter' : connection + ' direct'}: ${message}`,
        502,
        diagnostics,
      );
    }
    let data: ProviderResponse;
    try {
      data = (await response.json()) as ProviderResponse;
    } catch {
      throw new RequestError(
        `Provider returned an unreadable response (HTTP ${response.status}).`,
        502,
      );
    }
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
    if (terms.length && ['gpt', 'voxtral'].includes(input.id))
      hints = 'Not sent: no custom vocabulary support via OpenRouter.';
    if (terms.length && input.id === 'mai') {
      options.azure = { phraseList: { phrases: terms } };
      hints = 'Phrase list sent via OpenRouter; recognition is not guaranteed.';
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
  } else if (connection === 'openai') {
    const form = new FormData();
    form.append('file', blob, 'take.wav');
    form.append('model', model);
    form.append('response_format', 'json');
    if (english) form.append('languages[]', 'en');
    for (const term of terms) form.append('keywords[]', term);
    const data = await request(
      'https://api.openai.com/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      },
    );
    transcript = text(data.text);
    settings = {
      languages: english ? ['en'] : [],
      keywords: terms,
      response_format: 'json',
    };
    if (terms.length) hints = 'Keywords sent directly to OpenAI.';
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
      .filter((step) => step.type === 'model_output')
      .flatMap((step) => step.content || [])
      .filter((part) => typeof part.text === 'string')
      .map((part) => part.text);
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
    let polls = 0;
    while (result.status !== 'completed' && result.status !== 'error') {
      if (polls++ >= 40)
        throw new RequestError(
          'AssemblyAI is still processing after 40 checks. Stop waiting here; the provider may still finish and charge for this job.',
          504,
        );
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
  } else if (connection === 'deepgram') {
    const params = new URLSearchParams({
      model,
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
