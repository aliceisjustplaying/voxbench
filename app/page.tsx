'use client';
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
import { KEY_STORAGE, parseKeys, saveKeys } from '@/lib/key-storage';
import { Connections } from '@/components/lab/connections';
import { ResultCard, type Result } from '@/components/lab/result-card';
import { models, connectionFor, type Keys } from '@/lib/models';
import { importVocabulary, parseVocabulary } from '@/lib/comparison';
import { prepareClip, downloadBlob, MAX_SECONDS, type Clip } from '@/lib/audio';
import type { TranscriptionOutput } from '@/lib/transcription';

type Run = {
  id: string;
  at: string;
  clip: Clip;
  terms: string[];
  english: boolean;
  reference: string;
  results: Result[];
};
export default function Home() {
  const [keys, setKeys] = useState<Keys>({}),
    [keysOpen, setKeysOpen] = useState(false);
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
        'Could not restore saved keys. Your existing backup has not been changed. Import your backup to recover it.',
      );
    }
    setKeysLoaded(true);
  }, []);
  function updateKeys(next: Keys) {
    setKeys(next);
    try {
      saveKeys(localStorage, next);
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
  const [vocabulary, setVocabulary] = useState(''),
    [useVocabulary, setUseVocabulary] = useState(true),
    [english, setEnglish] = useState(true),
    [reference, setReference] = useState('');
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
      urls.current.forEach(URL.revokeObjectURL);
    };
  }, []);
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
  async function loadClip(blob: Blob, name: string) {
    setPreparing(true);
    setError('');
    try {
      const next = await prepareClip(blob, name);
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
        throw new Error(
          'Recording is unavailable in this browser. You can upload an audio file instead.',
        );
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
        if (sec >= MAX_SECONDS) stopRecording();
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
      const data = (await response.json()) as TranscriptionOutput & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error || 'The provider request failed.');
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
    if (!clip || !selected.length || busyRef.current) return;
    if (!ready) {
      setKeysOpen(true);
      return;
    }
    const terms = useVocabulary ? parseVocabulary(vocabulary) : [];
    if (
      terms.length > 100 ||
      terms.some(
        (t) =>
          t.length > 49 || t.split(/\s+/).length > 5 || /[<>{}\[\]\\]/.test(t),
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
      results: selected.map((id) => ({ id, status: 'queued' })),
    };
    setRuns((old) => [run, ...old]);
    setActiveId(run.id);
    busyRef.current = true;
    setBusy(true);
    cancelled.current = false;
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
      'voice-lab-' + active.at.replaceAll(':', '-') + '.json',
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
      <header>
        <a className="brand" href="/">
          <AudioLines /> voice lab<span>PERSONAL SPEECH BENCH</span>
        </a>
        <Button
          variant="outline"
          onClick={() => setKeysOpen(true)}
          disabled={busy}
        >
          <KeyRound />
          {keyCount ? `${keyCount} accounts added` : 'Connect accounts'}
        </Button>
      </header>
      <section className="intro">
        <div>
          <span className="eyebrow">YOUR VOICE. SAME RECORDING.</span>
          <h1>Find the model that gets you.</h1>
          <p>
            Compare the words first. Pick the voice keyboard backend second.
          </p>
        </div>
        <span className="bench-tag">
          11 contenders
          <br />
          <strong>Your accent is the test.</strong>
        </span>
      </section>
      <section className="workspace">
        <div className="capture">
          <div className="section-label">01 — THE RECORDING</div>
          <h2>
            {recording
              ? 'Make it sound like you.'
              : clip
                ? 'One take. Ready to compare.'
                : 'Start with your voice'}
          </h2>
          <div className={'record-circle ' + (recording ? 'recording' : '')}>
            {preparing ? (
              <Loader2 className="spin" size={30} />
            ) : recording ? (
              <AudioLines size={34} />
            ) : (
              <Mic size={30} />
            )}
          </div>
          <div className="clock">
            {recording
              ? `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`
              : clip
                ? `${clip.duration.toFixed(1)} seconds`
                : 'Up to 60 seconds'}
          </div>
          <div className="record-actions">
            <Button
              onClick={recording ? stopRecording : startRecording}
              disabled={preparing || busy}
            >
              {recording ? <Square /> : <Mic />}
              {recording
                ? 'Stop recording'
                : clip
                  ? 'Record another'
                  : 'Record a take'}
            </Button>
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
                if (file) void loadClip(file, file.name);
                e.target.value = '';
              }}
            />
          </div>
          {clip && !recording ? (
            <div className="audio-preview">
              <audio key={clip.url} controls src={clip.url} />
              <div>
                <span>{clip.name}</span>
                <button
                  onClick={() => downloadBlob(clip.blob, 'voice-lab-take.wav')}
                  title="Download the exact audio used"
                >
                  Save WAV <Download size={13} />
                </button>
              </div>
              <small>
                Every model receives the same mono WAV.
                <br />
                Audio ID {clip.hash.slice(0, 12)}
              </small>
            </div>
          ) : (
            <p className="record-tip">
              Use your everyday pace, names, and technical words. Nothing is
              sent while recording.
            </p>
          )}
          <div className="vocab">
            <div className="vocab-heading">
              <label className="check-label">
                <Checkbox
                  checked={useVocabulary}
                  onCheckedChange={(v) => setUseVocabulary(!!v)}
                  disabled={busy}
                />
                Vocabulary hints
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
            <div className="dictionary-import">
              <small>
                One term per line. Hint support varies by connection.
              </small>
              <button
                disabled={busy}
                onClick={() => dictionaryUpload.current?.click()}
              >
                Import dictionary ↥
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
            <label className="check-label language">
              <Checkbox
                checked={english}
                onCheckedChange={(v) => setEnglish(!!v)}
                disabled={busy}
              />
              English hints <small>Uncheck for auto-detection</small>
            </label>
          </div>
        </div>
        <div className="lineup">
          <div className="section-label">02 — THE LINEUP</div>
          <div className="lineup-title">
            <h2>Who’s listening?</h2>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                setSelected(
                  selected.length === models.length
                    ? []
                    : models.map((m) => m.id),
                )
              }
            >
              {selected.length === models.length
                ? 'Deselect all'
                : 'Select all'}
            </button>
          </div>
          <div className="model-grid">
            {models.map((m) => {
              const c = connectionFor(m, keys),
                hasKey = !!keys[c]?.trim();
              return (
                <label
                  className={
                    'model-choice ' + (selected.includes(m.id) ? 'chosen' : '')
                  }
                  key={m.id}
                >
                  <Checkbox
                    checked={selected.includes(m.id)}
                    onCheckedChange={(checked) =>
                      setSelected((old) =>
                        checked
                          ? [...old, m.id]
                          : old.filter((id) => id !== m.id),
                      )
                    }
                    disabled={busy}
                  />
                  <span className="model-details">
                    <strong>{m.name}</strong>
                    <span className="model-meta">
                      {m.maker} · {c === 'openrouter' ? 'OpenRouter' : 'Direct'}
                    </span>
                    <small>{m.vocabulary}</small>
                  </span>
                  <span
                    className={'key-dot ' + (hasKey ? 'present' : '')}
                    title={
                      hasKey ? 'Key entered; not yet verified' : 'Key needed'
                    }
                  />
                </label>
              );
            })}
          </div>
          <div className="compare-bar">
            <div>
              <strong>{selected.length} selected</strong>
              <span>{ready} with keys entered</span>
            </div>
            {busy ? (
              <Button variant="outline" onClick={cancel}>
                <X />
                Stop comparison
              </Button>
            ) : (
              <Button
                disabled={!clip || preparing || recording || !selected.length}
                onClick={compare}
              >
                <Play />
                {ready ? 'Compare this take' : 'Add keys to compare'}
                <ArrowUpRight />
              </Button>
            )}
          </div>
          <p className="billing-note">
            Compare sends audio to the selected providers with keys. Each
            request is billed by that provider. Missing keys are shown as
            skipped.
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
            <div className="section-label">03 — SIDE BY SIDE</div>
            <h2>
              {active
                ? 'Same take. Different ears.'
                : 'Your transcripts will appear here.'}
            </h2>
          </div>
          {active ? (
            <div className="view-actions">
              <Tabs value={view} onValueChange={(v) => setView(String(v))}>
                <TabsList>
                  <TabsTrigger value="raw">Raw</TabsTrigger>
                  <TabsTrigger value="lowercase">lowercase</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button variant="outline" size="sm" onClick={exportRun}>
                <Download />
                Export run
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
            Reference transcript <span>Optional · what you actually said</span>
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
            placeholder="Type the exact words, including hesitations if you want to score them. No provider receives this text."
          />
          <p>
            Word errors count substitutions, missing words and extra words. Case
            and punctuation are ignored. Lowercase is a local preview; scores
            always use the raw transcript.
          </p>
        </details>
        {active ? (
          <>
            <div className="run-meta">
              <span>
                {active.clip.duration.toFixed(1)}s ·{' '}
                {active.clip.hash.slice(0, 12)} · {active.terms.length}{' '}
                vocabulary hints ·{' '}
                {active.english ? 'English hints' : 'Auto language'}
              </span>
              <span aria-live="polite">
                {
                  active.results.filter((r) =>
                    ['done', 'error', 'skipped', 'cancelled'].includes(
                      r.status,
                    ),
                  ).length
                }
                /{active.results.length} finished
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
              Timing includes whole-file upload and provider processing, not
              live streaming latency. Up to three requests run together. A blank
              cost means the provider did not report it.
            </p>
          </>
        ) : (
          <div className="empty-results">
            <AudioLines size={30} />
            <p>
              Record a take, choose your models, then compare.
              <br />
              Real results only — no sample transcripts.
            </p>
          </div>
        )}
      </section>
      <footer>
        <span>
          This site does not save audio, keys or results. Export before closing.
          Selected providers receive audio and apply their own data policies.
        </span>
        <details>
          <summary>Model sources · checked 5 Sep 2026</summary>
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
