'use client';
import { useMemo, useState } from 'react';
import { Check, Copy, Loader2, RotateCcw, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { models } from '@/lib/models';
import { compareWords, vocabularyHits } from '@/lib/comparison';
import type {
  TranscriptionOutput,
  ProviderDiagnostics,
} from '@/lib/transcription';
export type Result = {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'skipped' | 'cancelled';
  output?: TranscriptionOutput;
  error?: string;
  diagnostics?: ProviderDiagnostics;
  note?: string;
  preferred?: boolean;
};
export function ResultCard({
  result,
  reference,
  terms,
  lowercase,
  busy,
  onRetry,
  onChange,
}: {
  result: Result;
  reference: string;
  terms: string[];
  lowercase: boolean;
  busy: boolean;
  onRetry: () => void;
  onChange: (patch: Partial<Result>) => void;
}) {
  const m = models.find((x) => x.id === result.id)!;
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const score = useMemo(
    () => (result.output ? compareWords(reference, result.output.text) : null),
    [reference, result.output],
  );
  const hits = result.output ? vocabularyHits(result.output.text, terms) : [];
  const transcript = result.output
    ? lowercase
      ? result.output.text.toLocaleLowerCase('en')
      : result.output.text
    : '';
  async function copy() {
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      setCopyError('');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError('Copy was blocked. Select the transcript text to copy it.');
    }
  }
  return (
    <article className={'result-card ' + (result.preferred ? 'preferred' : '')}>
      <div className="result-top">
        <div>
          <span className="eyebrow">{m.maker}</span>
          <h3>{m.name}</h3>
        </div>
        <span className={'state ' + result.status}>
          {result.status === 'running' ? (
            <Loader2 className="spin" size={15} />
          ) : null}
          {
            {
              queued: 'Queued',
              running: 'Transcribing',
              done: 'Complete',
              error: 'Failed',
              skipped: 'Key needed',
              cancelled: 'Stopped',
            }[result.status]
          }
        </span>
      </div>
      {result.status === 'done' && result.output ? (
        <>
          <div className="result-stats">
            <span>
              {(result.output.elapsedMs / 1000).toFixed(1)}s{' '}
              <small>request time</small>
            </span>
            <span>
              {score ? `${(score.rate * 100).toFixed(1)}%` : '—'}{' '}
              <small>word errors</small>
            </span>
            <span>
              {result.output.cost !== null
                ? '$' + result.output.cost.toFixed(5)
                : '—'}{' '}
              <small>reported cost</small>
            </span>
          </div>
          <p className="transcript">
            {transcript || <i>No speech returned.</i>}
          </p>
          <div className="result-actions">
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? <Check /> : <Copy />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={!!result.preferred}
              onClick={() => onChange({ preferred: !result.preferred })}
            >
              <Star fill={result.preferred ? 'currentColor' : 'none'} />
              {result.preferred ? 'A favorite' : 'Prefer this'}
            </Button>
          </div>
          {copyError ? (
            <p role="status" className="error-text">
              {copyError}
            </p>
          ) : null}
          <details>
            <summary>Settings & differences</summary>
            <div className="result-details">
              <p>
                <strong>Model:</strong> {result.output.model}
              </p>
              <p>
                <strong>Connection:</strong> {result.output.connection}
              </p>
              <p>
                <strong>Vocabulary:</strong> {result.output.hints}
              </p>
              {terms.length ? (
                <p>
                  {hits.length} of {terms.length} listed terms appear in the
                  transcript. This is presence, not accuracy.
                </p>
              ) : null}
              <p>
                <strong>Same audio:</strong>{' '}
                {result.output.audioHash.slice(0, 16)}
              </p>
              {score ? (
                <>
                  <p>
                    {score.errors} edits / {score.referenceWords} reference
                    words. Case and punctuation ignored; numbers are not
                    normalized.
                  </p>
                  <div className="word-diff">
                    {score.edits.map((e, i) => (
                      <span key={i} className={e.kind}>
                        {e.kind === 'same'
                          ? e.actual
                          : e.kind === 'insert'
                            ? `+${e.actual}`
                            : e.kind === 'delete'
                              ? `−${e.expected}`
                              : `${e.expected} → ${e.actual}`}{' '}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p>Add a reference transcript to measure word errors.</p>
              )}
              <pre>{JSON.stringify(result.output.settings, null, 2)}</pre>
            </div>
          </details>
          <label className="note-label">
            Your notes
            <textarea
              value={result.note || ''}
              maxLength={2000}
              onChange={(e) => onChange({ note: e.target.value })}
              placeholder="Names it missed, phrasing it changed…"
              rows={2}
            />
          </label>
        </>
      ) : (
        <div className="result-placeholder">
          {result.status === 'queued'
            ? 'Waiting for an available comparison slot.'
            : result.status === 'running'
              ? 'Listening to the same take…'
              : result.error || 'This request was stopped.'}
          {result.diagnostics && (
            <details className="provider-diagnostics">
              <summary>Provider response details</summary>
              <p>
                Response body and selected headers, with credentials redacted.
                {result.diagnostics.truncated
                  ? ' Long response truncated.'
                  : ''}
              </p>
              <pre>{JSON.stringify(result.diagnostics, null, 2)}</pre>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      JSON.stringify(result.diagnostics, null, 2),
                    );
                    setCopied(true);
                    setCopyError('');
                  } catch {
                    setCopyError(
                      'Select the details above and copy them manually.',
                    );
                  }
                }}
              >
                {copied ? 'Copied' : 'Copy error details'}
              </Button>
              {copyError && <p role="status">{copyError}</p>}
            </details>
          )}
          {['error', 'skipped', 'cancelled'].includes(result.status) ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onRetry}
            >
              <RotateCcw />
              Retry this model
            </Button>
          ) : null}
        </div>
      )}
    </article>
  );
}
