export type Connection =
  | 'openrouter'
  | 'meta'
  | 'gemini'
  | 'elevenlabs'
  | 'assemblyai'
  | 'mistral'
  | 'deepgram';
export type Model = {
  id: string;
  name: string;
  maker: string;
  connection: Connection;
  model: string;
  vocabulary: string;
  direct?: Connection;
  directModel?: string;
  docs: string;
};
export const models: Model[] = [
  {
    id: 'muse',
    name: 'Muse Voice Transcribe',
    maker: 'Meta',
    connection: 'meta',
    model: 'muse-voice-transcribe-1.0',
    vocabulary: 'Keyword hints',
    docs: 'https://github.com/meta-models/meta-model-cookbook/tree/main/06_muse_voice/01_voice_api_fundamentals',
  },
  {
    id: 'gemini',
    name: 'Gemini 3.5 Transcribe',
    maker: 'Google',
    connection: 'gemini',
    model: 'gemini-3.5-transcribe',
    vocabulary: 'Custom vocabulary',
    docs: 'https://ai.google.dev/gemini-api/docs/transcribe',
  },
  {
    id: 'gpt',
    name: 'GPT Transcribe',
    maker: 'OpenAI',
    connection: 'openrouter',
    model: 'openai/gpt-transcribe',
    vocabulary: 'Hints via OpenRouter; forwarding unverified',
    docs: 'https://openrouter.ai/openai/gpt-transcribe',
  },
  {
    id: 'scribe',
    name: 'Scribe v2',
    maker: 'ElevenLabs',
    connection: 'elevenlabs',
    model: 'scribe_v2',
    vocabulary: 'Keyterms · additional provider charge',
    docs: 'https://elevenlabs.io/docs/overview/capabilities/speech-to-text',
  },
  {
    id: 'voxtral',
    name: 'Voxtral Mini Transcribe 2',
    maker: 'Mistral',
    connection: 'openrouter',
    model: 'mistralai/voxtral-mini-transcribe',
    direct: 'mistral',
    directModel: 'voxtral-mini-2602',
    vocabulary: 'Context hints · direct key optional',
    docs: 'https://docs.mistral.ai/models/voxtral-mini-transcribe-26-02',
  },
  {
    id: 'assembly',
    name: 'Universal-3.5 Pro',
    maker: 'AssemblyAI',
    connection: 'assemblyai',
    model: 'universal-3-5-pro',
    vocabulary: 'Keyterm hints',
    docs: 'https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/submit',
  },
  {
    id: 'nova',
    name: 'Nova-3',
    maker: 'Deepgram',
    connection: 'openrouter',
    model: 'deepgram/nova-3',
    direct: 'deepgram',
    directModel: 'nova-3',
    vocabulary: 'Vocabulary requires a direct Deepgram key',
    docs: 'https://developers.deepgram.com/docs/keyterm',
  },
  {
    id: 'mai',
    name: 'MAI-Transcribe 2',
    maker: 'Microsoft',
    connection: 'openrouter',
    model: 'microsoft/mai-transcribe-2',
    vocabulary: 'No hints sent in this spike',
    docs: 'https://openrouter.ai/microsoft/mai-transcribe-2',
  },
  {
    id: 'nemotron',
    name: 'Nemotron 3.5 ASR',
    maker: 'NVIDIA',
    connection: 'openrouter',
    model: 'nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b',
    vocabulary: 'No hints sent in this spike',
    docs: 'https://openrouter.ai/nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b',
  },
  {
    id: 'qwen',
    name: 'Qwen3 ASR 1.7B',
    maker: 'Qwen',
    connection: 'openrouter',
    model: 'qwen/qwen3-asr-1.7b',
    vocabulary: 'No hints sent in this spike',
    docs: 'https://openrouter.ai/qwen/qwen3-asr-1.7b',
  },
  {
    id: 'parakeet',
    name: 'Parakeet TDT v3',
    maker: 'NVIDIA',
    connection: 'openrouter',
    model: 'nvidia/parakeet-tdt-0.6b-v3',
    vocabulary: 'No hints sent in this spike',
    docs: 'https://openrouter.ai/nvidia/parakeet-tdt-0.6b-v3',
  },
];
export const connections: {
  id: Connection;
  name: string;
  url: string;
  note: string;
}[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    url: 'https://openrouter.ai/keys',
    note: 'One balance for OpenAI, Mistral, Deepgram, Microsoft, NVIDIA and Qwen.',
  },
  {
    id: 'meta',
    name: 'Meta Model API',
    url: 'https://developer.meta.com/ai/products/meta-model-api/',
    note: 'Muse Voice Transcribe. Model access depends on your Meta account.',
  },
  {
    id: 'gemini',
    name: 'Google AI Studio',
    url: 'https://aistudio.google.com/apikey',
    note: 'Gemini 3.5 Transcribe, including custom vocabulary.',
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    url: 'https://elevenlabs.io/app/settings/api-keys',
    note: 'Scribe v2. Keyterm hints may cost extra.',
  },
  {
    id: 'assemblyai',
    name: 'AssemblyAI',
    url: 'https://www.assemblyai.com/dashboard/signup',
    note: 'Universal-3.5 Pro. Audio is uploaded to AssemblyAI for its transcription job.',
  },
  {
    id: 'mistral',
    name: 'Mistral · optional direct key',
    url: 'https://console.mistral.ai/',
    note: 'Uses Mistral directly when entered, including context hints.',
  },
  {
    id: 'deepgram',
    name: 'Deepgram · optional direct key',
    url: 'https://console.deepgram.com/',
    note: 'Uses Deepgram directly when entered, enabling vocabulary hints.',
  },
];
export type Keys = Partial<Record<Connection, string>>;
export function connectionFor(m: Model, keys: Keys): Connection {
  return m.direct && keys[m.direct]?.trim() ? m.direct : m.connection;
}
