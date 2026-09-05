'use client';
/* oxlint-disable react/set-state-in-effect -- Restore browser storage after hydration and synchronize externally changed credentials. */
import Script from 'next/script';
import { readApiResponse } from '@/lib/api-response';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Mic,
  AudioLines,
  ArrowUpRight,
  Upload,
  Square,
  KeyRound,
  Download,
  Play,
  Loader2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  KEY_STORAGE,
  parseKeys,
  mergeSavedKeys,
  VOCABULARY_STORAGE,
  saveVocabulary,
} from '@/lib/key-storage';
import { DemoCheck } from '@/components/lab/demo-check';
import { OpenRouterConnect } from '@/components/lab/openrouter-connect';
import { Connections } from '@/components/lab/connections';
import { ResultCard, type Result } from '@/components/lab/result-card';
import { models, connectionFor, type Keys } from '@/lib/models';
import { importVocabulary, parseVocabulary } from '@/lib/comparison';
import { prepareClip, downloadBlob, MAX_SECONDS, type Clip } from '@/lib/audio';
import type {
  TranscriptionOutput,
  ProviderDiagnostics,
} from '@/lib/transcription';

type Run = {
  id: string;
  at: string;
  clip: Clip;
  terms: string[];
  english: boolean;
  reference: string;
  results: Result[];
  sponsored?: boolean;
};
const FREE_MODELS = ['gpt', 'voxtral', 'mai'];
type DemoStatus = { available: boolean; remaining?: number; siteKey?: string };
export default function Home() {
  const [mode, setMode] = useState<'free' | 'own'>('own');
  const [demo, setDemo] = useState<DemoStatus>({ available: false });
  const [demoToken, setDemoToken] = useState('');
  const [demoReset, setDemoReset] = useState(0);
  useEffect(() => {
    void fetch('/api/demo')
      .then((r) => r.json() as Promise<DemoStatus>)
      .then((status: DemoStatus) => {
        setDemo(status);
        try {
          if (
            status.available &&
            !Object.values(
              parseKeys(localStorage.getItem(KEY_STORAGE) || '{}'),
            ).some((k) => k?.trim())
          )
            setMode('free');
        } catch {
          /* Keep manual setup on storage errors. */
        }
      })
      .catch(() => {});
  }, []);
  const [keys, setKeys] = useState<Keys>({}),
    [keysOpen, setKeysOpen] = useState(false);
  useEffect(() => {
    // Covers manual entry, imports and OpenRouter's cross-tab OAuth callback.
    // A deliberate later choice of Try free remains until the keys change.
    if (Object.values(keys).some((key) => key?.trim().length >= 8))
      setMode('own');
  }, [keys]);
  const [keyStorageStatus, setKeyStorageStatus] = useState(
    'Loading saved keys…',
  );
  const [keysLoaded, setKeysLoaded] = useState(false);
  useEffect(() => {
    try {
      const backup = localStorage.getItem(KEY_STORAGE);
      if (backup !== null) setKeys(parseKeys(backup));
      setKeyStorageStatus('Keys save automatically in this browser.');
    } catch {
      setKeyStorageStatus(
        'Saved keys could not be read. Your backup is intact; import it to recover.',
      );
    }
    setKeysLoaded(true);
  }, []);
  function updateKeys(patch: Keys, replace = false) {
    setKeys(replace ? patch : { ...keys, ...patch });
    try {
      const saved = mergeSavedKeys(localStorage, patch, replace);
      setKeys(saved);
      setKeyStorageStatus('Saved in this browser.');
    } catch {
      setKeyStorageStatus(
        'Could not save keys. Keep this tab open and export a backup before refreshing.',
      );
    }
  }
  const [selected, setSelected] = useState(models.slice(0, 8).map((m) => m.id));
  const [clip, setClip] = useState<Clip | null>(null),
    [recording, setRecording] = useState(false),
    [preparing, setPreparing] = useState(false),
    [elapsed, setElapsed] = useState(0);
  const [vocabulary, setVocabularyValue] = useState(''),
    [useVocabulary, setUseVocabulary] = useState(true),
    [english, setEnglish] = useState(true),
    [reference, setReference] = useState('');
  const [vocabularyStorageError, setVocabularyStorageError] = useState('');
  const [vocabularySaved, setVocabularySaved] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VOCABULARY_STORAGE);
      if (saved !== null) {
        setVocabularyValue(saved);
        setVocabularySaved(true);
      }
    } catch {
      setVocabularyStorageError(
        'Could not restore vocabulary from this browser.',
      );
    }
  }, []);
  function setVocabulary(value: string) {
    setVocabularyValue(value);
    try {
      saveVocabulary(localStorage, value);
      setVocabularySaved(true);
      setVocabularyStorageError('');
    } catch {
      setVocabularySaved(false);
      setVocabularyStorageError(
        'Could not save vocabulary. Copy it before refreshing.',
      );
    }
  }
  useEffect(() => {
    function syncStorage(event: StorageEvent) {
      if (event.storageArea !== localStorage) return;
      if (event.key === KEY_STORAGE || event.key === null) {
        try {
          setKeys(parseKeys(event.newValue ?? '{}'));
          setKeyStorageStatus(
            event.newValue
              ? 'Updated from another tab.'
              : 'Saved keys were removed in another tab.',
          );
        } catch {
          setKeyStorageStatus(
            'Another tab saved an unreadable key backup. Current keys are unchanged.',
          );
        }
      }
      if (event.key === VOCABULARY_STORAGE || event.key === null) {
        setVocabularyValue(event.newValue ?? '');
        setVocabularySaved(event.newValue !== null);
        setVocabularyStorageError('');
      }
    }
    window.addEventListener('storage', syncStorage);
    return () => window.removeEventListener('storage', syncStorage);
  }, []);
  const [runs, setRuns] = useState<Run[]>([]),
    [activeId, setActiveId] = useState(''),
    [busy, setBusy] = useState(false),
    [view, setView] = useState('raw'),
    [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setInterval> | null>(null),
    controllers = useRef<AbortController[]>([]),
    cancelled = useRef(false),
    busyRef = useRef(false),
    urls = useRef<string[]>([]),
    upload = useRef<HTMLInputElement>(null),
    dictionaryUpload = useRef<HTMLInputElement>(null),
    mounted = useRef(true);
  const active = runs.find((r) => r.id === activeId);
  const keyCount = Object.values(keys).filter((v) => v?.trim()).length;
  const ready = selected.filter((id) => {
    const m = models.find((m) => m.id === id)!;
    return keys[connectionFor(m, keys)]?.trim();
  }).length;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      if (timer.current) clearInterval(timer.current);
      controllers.current.forEach((c) => c.abort());
      urls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);
  useEffect(() => {
    const retained = new Set(runs.map((run) => run.clip.url));
    if (clip) retained.add(clip.url);
    urls.current = urls.current.filter((url) => {
      if (retained.has(url)) return true;
      URL.revokeObjectURL(url);
      return false;
    });
  }, [runs, clip]);
  const updateResult = useCallback(
    (runId: string, id: string, patch: Partial<Result>) =>
      setRuns((old) =>
        old.map((r) =>
          r.id === runId
            ? {
                ...r,
                results: r.results.map((x) =>
                  x.id === id ? { ...x, ...patch } : x,
                ),
              }
            : r,
        ),
      ),
    [],
  );
  async function loadDictionary(file: File) {
    try {
      if (file.size > 1000000)
        throw new Error('Choose a dictionary file smaller than 1 MB.');
      const terms = importVocabulary(await file.text());
      if (!terms.length) throw new Error('No dictionary entries found.');
      setVocabulary(terms.join('\n'));
      setUseVocabulary(true);
      setError('');
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not read the dictionary.',
      );
    }
  }
  async function loadClip(
    blob: Blob,
    name: string,
    source: Clip['source'] = 'upload',
  ) {
    setPreparing(true);
    setError('');
    try {
      const next = await prepareClip(blob, name, source);
      if (!mounted.current) {
        URL.revokeObjectURL(next.url);
        return;
      }
      urls.current.push(next.url);
      setClip(next);
      setReference('');
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not prepare the recording.',
      );
    } finally {
      setPreparing(false);
    }
  }
  function stopRecording() {
    if (timer.current) clearInterval(timer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
    setRecording(false);
  }
  async function startRecording() {
    if (preparing || recording || busyRef.current) return;
    setError('');
    setPreparing(true);
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === 'undefined'
      )
        throw new Error('This browser can’t record. Upload an audio file.');
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1 },
        video: false,
      });
      stream.current = s;
      if (!mounted.current) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(
        (m) => MediaRecorder.isTypeSupported(m),
      );
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      recorder.current = r;
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = () => {
        s.getTracks().forEach((t) => t.stop());
        if (mounted.current)
          void loadClip(
            new Blob(chunks, { type: r.mimeType }),
            'Recorded take',
            'recording',
          );
      };
      r.onerror = () => {
        stopRecording();
        setError(
          'The microphone stopped unexpectedly. Please try another take.',
        );
      };
      r.start(200);
      setElapsed(0);
      setRecording(true);
      const began = Date.now();
      timer.current = setInterval(() => {
        const sec = (Date.now() - began) / 1000;
        setElapsed(sec);
        if (sec >= (mode === 'free' ? 29.5 : MAX_SECONDS)) stopRecording();
      }, 100);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow microphone access, or upload a recording.'
          : e instanceof Error
            ? e.message
            : 'Could not start the microphone.',
      );
    } finally {
      setPreparing(false);
    }
  }
  async function send(run: Run, id: string) {
    const m = models.find((x) => x.id === id)!,
      connection = connectionFor(m, keys),
      key = keys[connection]?.trim();
    if (cancelled.current) {
      updateResult(run.id, id, { status: 'cancelled' });
      return;
    }
    if (!key) {
      updateResult(run.id, id, {
        status: 'skipped',
        error: `Add your ${connection} key in Connections, then retry.`,
      });
      return;
    }
    const controller = new AbortController();
    controllers.current.push(controller);
    updateResult(run.id, id, {
      status: 'running',
      error: undefined,
      diagnostics: undefined,
      output: undefined,
      note: undefined,
      preferred: false,
    });
    try {
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          connection,
          key,
          audio: run.clip.base64,
          vocabulary: run.terms,
          english: run.english,
        }),
        signal: controller.signal,
      });
      const data = await readApiResponse<
        TranscriptionOutput & {
          error?: string;
          diagnostics?: ProviderDiagnostics;
        }
      >(response);
      if (!response.ok) {
        updateResult(run.id, id, {
          status: 'error',
          error: data.error || 'The provider request failed.',
          diagnostics: data.diagnostics,
        });
        return;
      }
      const output = data as TranscriptionOutput;
      if (output.audioHash !== run.clip.hash)
        throw new Error('Audio verification failed. Please retry this model.');
      updateResult(run.id, id, { status: 'done', output });
    } catch (e) {
      updateResult(run.id, id, {
        status: controller.signal.aborted ? 'cancelled' : 'error',
        error: controller.signal.aborted
          ? 'Stopped. Audio already received by the provider may still be billed.'
          : e instanceof Error
            ? e.message
            : 'The provider could not be reached.',
      });
    } finally {
      controllers.current = controllers.current.filter((c) => c !== controller);
    }
  }
  async function compare() {
    if (!clip || (mode === 'own' && !selected.length) || busyRef.current)
      return;
    if (mode === 'own' && !ready) {
      setKeysOpen(true);
      return;
    }
    if (
      mode === 'free' &&
      (clip.duration > 30 || !demoToken || !demo.remaining)
    ) {
      setError(
        clip.duration > 30
          ? 'Free comparisons use clips of 30 seconds or less.'
          : !demo.remaining
            ? 'Your free trials have been used. Connect OpenRouter or add your own key.'
            : 'Complete the verification checkbox before comparing.',
      );
      return;
    }
    if (mode === 'free' && clip.source !== 'recording') {
      setError(
        'The free trial uses microphone recordings. Record a take, or compare this file with your own keys.',
      );
      return;
    }
    const terms = useVocabulary ? parseVocabulary(vocabulary) : [];
    if (
      terms.length > 100 ||
      terms.some(
        (t) =>
          t.length > 49 || t.split(/\s+/).length > 5 || /[<>{}[\]\\]/.test(t),
      )
    ) {
      setError(
        'Use up to 100 vocabulary terms, each under 50 characters and at most five words, without brackets or backslashes.',
      );
      return;
    }
    setError('');
    const run: Run = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      clip,
      terms,
      english,
      reference,
      sponsored: mode === 'free',
      results: (mode === 'free' ? FREE_MODELS : selected).map((id) => ({
        id,
        status: 'queued',
      })),
    };
    setRuns((old) => [run, ...old].slice(0, 20));
    setActiveId(run.id);
    busyRef.current = true;
    setBusy(true);
    cancelled.current = false;
    if (mode === 'free') {
      const controller = new AbortController();
      controllers.current.push(controller);
      for (const id of FREE_MODELS)
        updateResult(run.id, id, { status: 'running' });
      try {
        const response = await fetch('/api/demo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audio: clip.base64,
            vocabulary: terms,
            english,
            token: demoToken,
          }),
          signal: controller.signal,
        });
        const data = await readApiResponse<{
          results?: Result[];
          remaining?: number;
          error?: string;
        }>(response);
        if (!response.ok || !data.results)
          throw new Error(
            data.error || 'The free comparison could not finish.',
          );
        for (const result of data.results) {
          if (result.output && result.output.audioHash !== clip.hash)
            throw new Error('Audio verification failed.');
          updateResult(run.id, result.id, result);
        }
        setDemo((old) => ({ ...old, remaining: data.remaining }));
      } catch (e) {
        for (const id of FREE_MODELS)
          updateResult(run.id, id, {
            status: controller.signal.aborted ? 'cancelled' : 'error',
            error:
              e instanceof Error ? e.message : 'The free comparison failed.',
          });
      } finally {
        controllers.current = controllers.current.filter(
          (c) => c !== controller,
        );
        setDemoToken('');
        setDemoReset((n) => n + 1);
        void fetch('/api/demo')
          .then((r) => r.json() as Promise<DemoStatus>)
          .then(setDemo)
          .catch(() => {});
        busyRef.current = false;
        setBusy(false);
      }
      return;
    }
    const queue = [...selected];
    try {
      await Promise.all(
        Array.from({ length: 3 }, async () => {
          while (queue.length && !cancelled.current) {
            const id = queue.shift()!;
            await send(run, id);
          }
        }),
      );
      if (cancelled.current)
        for (const id of queue)
          updateResult(run.id, id, { status: 'cancelled' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function retry(run: Run, id: string) {
    if (busyRef.current) return;
    if (run.sponsored) {
      setMode('own');
      setKeysOpen(true);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    cancelled.current = false;
    try {
      await send(run, id);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function cancel() {
    cancelled.current = true;
    controllers.current.forEach((c) => c.abort());
  }
  function exportRun() {
    if (!active) return;
    const { base64: _, url: __, blob: ___, ...clipInfo } = active.clip;
    downloadBlob(
      new Blob(
        [
          JSON.stringify(
            {
              ...active,
              clip: clipInfo,
              scoring:
                'Word edit distance; case and punctuation ignored, numbers not normalized. Timing is whole-file request time, not live latency.',
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
      'voxbench-' + active.at.replaceAll(':', '-') + '.json',
    );
  }
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (tool: unknown, options: unknown) => Promise<void>;
        };
      }
    ).modelContext;
    if (!context) return;
    const controller = new AbortController();
    const register = (tool: unknown) => {
      try {
        Promise.resolve(
          context.registerTool(tool, { signal: controller.signal }),
        ).catch(() => {});
      } catch {}
    };
    register({
      name: 'read_voice_comparison',
      description:
        'Read the displayed comparison results and model names. Does not expose API keys or audio.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => ({
        models: models.map((m) => ({ id: m.id, name: m.name })),
        run: active
          ? {
              id: active.id,
              reference: active.reference,
              results: active.results,
            }
          : null,
      }),
    });
    register({
      name: 'set_reference_transcript',
      description:
        'Set the expected words for the displayed comparison to calculate word errors. Does not send audio or start paid requests.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', maxLength: 10000 } },
        required: ['text'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input: unknown) => {
        const t = (input as { text?: unknown })?.text;
        if (typeof t !== 'string' || t.length > 10000)
          throw new Error('Expected text under 10000 characters.');
        if (active)
          setRuns((old) =>
            old.map((r) => (r.id === active.id ? { ...r, reference: t } : r)),
          );
        else setReference(t);
        return { reference: t };
      },
    });
    return () => controller.abort();
  }, [active]);
  return (
    <main className="lab">
      <Script
        id="plausible-init"
        strategy="afterInteractive"
      >{`window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()`}</Script>
      <Script
        async
        src="https://p.mosphere.at/js/pa-CGNBvNHBZdU1DjZgLJMEm.js"
        strategy="afterInteractive"
      />
      <header>
        <a className="brand" href="/">
          <AudioLines /> Voxbench
        </a>
        <Button
          variant="outline"
          onClick={() => setKeysOpen(true)}
          disabled={busy}
        >
          <KeyRound />
          {keyCount ? `API keys · ${keyCount}` : 'Add API keys'}
        </Button>
      </header>
      <section className="intro">
        <div>
          <h1>Eleven speech-to-text models, one recording of your voice.</h1>
          <p>
            Record a take, pick models, and read every transcript side by side.
            Add what you said to score word errors.
          </p>
        </div>
      </section>
      <section
        className="access-bar"
        aria-label="Choose how to pay for comparisons"
      >
        {demo.available && (
          <div className="access-choices">
            <button
              type="button"
              className="access-choice"
              aria-pressed={mode === 'free'}
              disabled={busy || recording}
              onClick={() => {
                setMode('free');
                setDemoToken('');
                setDemoReset((n) => n + 1);
              }}
            >
              Free trial · {demo.remaining ?? 0} left
            </button>
            <button
              type="button"
              className="access-choice"
              aria-pressed={mode === 'own'}
              disabled={busy || recording}
              onClick={() => {
                setMode('own');
                setDemoToken('');
              }}
            >
              My API keys
            </button>
          </div>
        )}
        {demo.available && (
          <p className="access-current" role="status">
            {mode === 'free'
              ? 'GPT, Voxtral and MAI · up to 30 seconds · Voxbench pays.'
              : 'All 11 models · up to 60 seconds · providers bill you.'}
          </p>
        )}
        {mode === 'own' && <OpenRouterConnect />}
      </section>
      <section className="workspace">
        <div className="capture">
          <button
            type="button"
            className={'record-circle ' + (recording ? 'recording' : '')}
            onClick={recording ? stopRecording : startRecording}
            disabled={preparing || busy}
            aria-label={
              recording
                ? 'Stop recording'
                : clip
                  ? 'Record another take'
                  : 'Record a take'
            }
            title={
              recording
                ? 'Stop recording'
                : clip
                  ? 'Record another take'
                  : 'Record a take'
            }
          >
            {preparing ? (
              <Loader2 className="spin" size={30} />
            ) : recording ? (
              <Square size={30} />
            ) : (
              <Mic size={30} />
            )}
          </button>
          <div className="clock">
            {recording
              ? `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`
              : clip
                ? `${clip.duration.toFixed(1)} seconds`
                : mode === 'free'
                  ? 'Up to 30 seconds'
                  : 'Up to 60 seconds'}
          </div>
          <div className="record-actions">
            {mode === 'own' && (
              <>
                <Button
                  variant="outline"
                  onClick={() => upload.current?.click()}
                  disabled={preparing || recording || busy}
                >
                  <Upload />
                  Upload
                </Button>
                <input
                  ref={upload}
                  type="file"
                  accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg,.flac"
                  className="sr-only"
                  aria-label="Upload an audio recording"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && mode === 'own') void loadClip(file, file.name);
                    e.target.value = '';
                  }}
                />
              </>
            )}
          </div>
          {clip && !recording ? (
            <div className="audio-preview">
              {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- This is the user’s audio input; transcripts are generated below. */}
              <audio
                key={clip.url}
                controls
                src={clip.url}
                aria-label="Your recording"
              />
              <div>
                <span>{clip.name}</span>
                <button
                  onClick={() => downloadBlob(clip.blob, 'voxbench-take.wav')}
                  title="Download the exact audio used"
                >
                  Save WAV <Download size={13} />
                </button>
              </div>
              <small>
                Every model gets the same 16 kHz mono WAV.
                <br />
                Audio ID {clip.hash.slice(0, 12)}
              </small>
            </div>
          ) : (
            <p className="record-tip">
              Speak at your normal pace, with the names and terms you use. Audio
              is sent only when you compare.
            </p>
          )}
          <details className="vocab">
            <summary>
              Vocabulary &amp; language
              <span>
                {useVocabulary
                  ? `${parseVocabulary(vocabulary).length} hints`
                  : 'Hints off'}
              </span>
            </summary>
            <div className="vocab-content">
              <div className="vocab-heading">
                <label className="check-label" htmlFor="use-vocabulary">
                  <Checkbox
                    id="use-vocabulary"
                    checked={useVocabulary}
                    onCheckedChange={(v) => setUseVocabulary(!!v)}
                    disabled={busy}
                  />
                  Send vocabulary hints
                </label>
                <small>{parseVocabulary(vocabulary).length}/100</small>
              </div>
              <textarea
                aria-label="Personal vocabulary"
                placeholder={'Alice\nSourdough\nMonologue'}
                rows={3}
                value={vocabulary}
                onChange={(e) => setVocabulary(e.target.value)}
                disabled={busy}
              />
              {vocabularyStorageError && (
                <p role="alert">{vocabularyStorageError}</p>
              )}
              <div className="dictionary-import">
                <small>
                  {vocabularySaved
                    ? 'Saved in this browser.'
                    : 'Saves automatically as you type.'}{' '}
                  One term per line.
                </small>
                <button
                  disabled={busy}
                  onClick={() => dictionaryUpload.current?.click()}
                >
                  Import a dictionary
                </button>
                <input
                  ref={dictionaryUpload}
                  type="file"
                  accept=".txt,.json"
                  className="sr-only"
                  aria-label="Import vocabulary from Monologue JSON or a text file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void loadDictionary(f);
                    e.target.value = '';
                  }}
                />
              </div>
              <label
                className="check-label language"
                htmlFor="english-language"
              >
                <Checkbox
                  id="english-language"
                  checked={english}
                  onCheckedChange={(v) => setEnglish(!!v)}
                  disabled={busy}
                />
                English <small>Uncheck to auto-detect language</small>
              </label>
            </div>
          </details>
        </div>
        <div className="lineup">
          <div className="lineup-title">
            <button
              className="text-button"
              disabled={busy || mode === 'free'}
              onClick={() =>
                setSelected(
                  selected.length === models.length
                    ? []
                    : models.map((m) => m.id),
                )
              }
            >
              {mode === 'free'
                ? 'Free trial: 3 models'
                : selected.length === models.length
                  ? 'Deselect all'
                  : 'Select all'}
            </button>
          </div>
          <div className="model-grid">
            {models
              .filter((m) => mode === 'own' || FREE_MODELS.includes(m.id))
              .map((m) => {
                const c =
                    mode === 'free' ? m.connection : connectionFor(m, keys),
                  hasKey = !!keys[c]?.trim();
                return (
                  <label
                    htmlFor={'model-' + m.id}
                    className={
                      'model-choice ' +
                      (mode === 'free' || selected.includes(m.id)
                        ? 'chosen'
                        : '')
                    }
                    key={m.id}
                  >
                    <Checkbox
                      id={'model-' + m.id}
                      checked={mode === 'free' || selected.includes(m.id)}
                      onCheckedChange={(checked) =>
                        setSelected((old) =>
                          checked
                            ? [...old, m.id]
                            : old.filter((id) => id !== m.id),
                        )
                      }
                      disabled={busy || mode === 'free'}
                    />
                    <span className="model-details">
                      <strong>{m.name}</strong>
                      <span className="model-meta">
                        {m.maker} ·{' '}
                        {c === 'openrouter' ? 'via OpenRouter' : 'direct'}
                      </span>
                      <small
                        className={
                          c === 'openrouter' &&
                          (m.id === 'gpt' || m.id === 'voxtral')
                            ? 'vocabulary-warning'
                            : undefined
                        }
                      >
                        {m.id === 'gpt'
                          ? c === 'openai'
                            ? 'Custom vocabulary via your OpenAI key'
                            : 'Add an OpenAI key for vocabulary'
                          : m.vocabulary}
                      </small>
                    </span>
                    <span
                      className={
                        'key-dot ' +
                        (mode === 'free' || hasKey ? 'present' : '')
                      }
                      title={
                        mode === 'free'
                          ? 'Included in your free comparison'
                          : hasKey
                            ? 'Key added'
                            : 'No key'
                      }
                    />
                  </label>
                );
              })}
          </div>
          {mode === 'free' && demo.siteKey && !!demo.remaining && (
            <DemoCheck
              siteKey={demo.siteKey}
              reset={demoReset}
              onToken={setDemoToken}
            />
          )}
          <div className="compare-bar">
            <div>
              <strong>
                {mode === 'free'
                  ? '3 models included'
                  : `${selected.length} selected`}
              </strong>
              <span>
                {mode === 'free'
                  ? `${demo.remaining ?? 0} free comparisons left`
                  : `${ready} with keys`}
              </span>
            </div>
            {busy ? (
              <Button variant="outline" onClick={cancel}>
                <X />
                Stop
              </Button>
            ) : (
              <Button
                disabled={
                  !clip ||
                  preparing ||
                  recording ||
                  (mode === 'free'
                    ? !demoToken ||
                      !demo.remaining ||
                      clip.duration > 30 ||
                      clip.source !== 'recording'
                    : !selected.length)
                }
                onClick={compare}
              >
                <Play />
                {mode === 'free'
                  ? 'Compare for free'
                  : ready
                    ? `Compare ${ready} ${ready === 1 ? 'model' : 'models'}`
                    : 'Add keys to compare'}
                <ArrowUpRight />
              </Button>
            )}
          </div>
          {mode === 'free' && clip && clip.source !== 'recording' && (
            <p role="alert">
              The free trial uses microphone recordings. Record a take, or
              compare this file with your own keys.
            </p>
          )}
          {mode === 'free' && clip && clip.duration > 30 && (
            <p role="alert">
              Free trial takes are up to 30 seconds. Record a shorter one, or
              use your own keys.
            </p>
          )}
          <p className="billing-note">
            {mode === 'free'
              ? 'Each attempt uses one free comparison, including failed ones. Limits apply per browser and network.'
              : 'Only models with a key run.'}
          </p>
        </div>
      </section>
      {error ? (
        <p role="alert" className="error-banner">
          {error}
        </p>
      ) : null}
      <section className="results">
        <div className="results-heading">
          <div>
            <h2 className="section-label">Transcripts</h2>
          </div>
          {active ? (
            <div className="view-actions">
              <Tabs value={view} onValueChange={(v) => setView(String(v))}>
                <TabsList>
                  <TabsTrigger value="raw">Raw</TabsTrigger>
                  <TabsTrigger value="lowercase">Lowercase</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button variant="outline" size="sm" onClick={exportRun}>
                <Download />
                Export JSON
              </Button>
            </div>
          ) : null}
        </div>
        {runs.length > 1 ? (
          <div className="run-history">
            {runs.map((r, i) => (
              <button
                key={r.id}
                aria-pressed={r.id === activeId}
                onClick={() => setActiveId(r.id)}
              >
                Take {runs.length - i} ·{' '}
                {new Date(r.at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                · {r.terms.length ? 'with hints' : 'no hints'}
              </button>
            ))}
          </div>
        ) : null}
        <details className="reference" open={!!active}>
          <summary>
            Reference <span>What you said · optional</span>
          </summary>
          <textarea
            aria-label="Reference transcript"
            maxLength={10000}
            rows={3}
            value={active ? active.reference : reference}
            onChange={(e) => {
              const t = e.target.value;
              if (active)
                setRuns((old) =>
                  old.map((r) =>
                    r.id === active.id ? { ...r, reference: t } : r,
                  ),
                );
              else setReference(t);
            }}
            placeholder="The exact words you said. Include hesitations to score them. Stays in your browser."
          />
          <p>
            Word errors count substituted, missing, and extra words, ignoring
            case and punctuation. Scores use the raw transcript.
          </p>
        </details>
        {active ? (
          <>
            <div className="run-meta">
              <span>
                {active.clip.duration.toFixed(1)}s ·{' '}
                {active.clip.hash.slice(0, 12)} · {active.terms.length}{' '}
                {active.terms.length === 1 ? 'hint' : 'hints'} ·{' '}
                {active.english ? 'English' : 'Auto-detect language'}
              </span>
              <span aria-live="polite">
                {
                  active.results.filter((r) =>
                    ['done', 'error', 'skipped', 'cancelled'].includes(
                      r.status,
                    ),
                  ).length
                }
                {' of '}
                {active.results.length} done
              </span>
            </div>
            <div className="result-grid">
              {active.results.map((r) => (
                <ResultCard
                  key={active.id + r.id}
                  result={r}
                  reference={active.reference}
                  terms={active.terms}
                  lowercase={view === 'lowercase'}
                  busy={busy}
                  onRetry={() => retry(active, r.id)}
                  onChange={(patch) => updateResult(active.id, r.id, patch)}
                />
              ))}
            </div>
            <p className="timing-note">
              Time covers upload and processing of the whole file. Up to three
              requests run at once. A blank cost means the provider reported
              none. The last 20 takes stay in this tab; export any you want to
              keep.
            </p>
          </>
        ) : (
          <div className="empty-results">
            <p>Transcripts appear here after you compare.</p>
          </div>
        )}
      </section>
      <footer>
        <a href="/privacy">Privacy</a>
        <span>
          Keys and vocabulary stay in this browser. Audio and keys pass through
          Voxbench to the providers you choose; their data policies apply. We
          log errors only.
        </span>
        <details>
          <summary>Model sources</summary>
          <div className="source-links">
            {models.map((m) => (
              <a key={m.id} href={m.docs} target="_blank" rel="noreferrer">
                {m.maker} · {m.name} ↗
              </a>
            ))}
          </div>
        </details>
      </footer>
      <Connections
        open={keysOpen}
        onOpenChange={setKeysOpen}
        keys={keys}
        onChange={updateKeys}
        storageStatus={keyStorageStatus}
        loaded={keysLoaded}
      />
    </main>
  );
}
