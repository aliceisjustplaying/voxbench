'use client';
import { useState } from 'react';
import { parseKeys } from '@/lib/key-storage';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { connections, type Keys } from '@/lib/models';
export function Connections({
  open,
  onOpenChange,
  keys,
  onChange,
  storageStatus,
  loaded,
}: {
  storageStatus: string;
  loaded: boolean;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  keys: Keys;
  onChange: (keys: Keys, replace?: boolean) => void;
}) {
  const [transfer, setTransfer] = useState<'import' | 'export' | null>(null);
  const [json, setJson] = useState('');
  const [message, setMessage] = useState('');
  function closeTransfer() {
    setTransfer(null);
    setJson('');
    setMessage('');
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeTransfer();
        onOpenChange(next);
      }}
    >
      <DialogContent className="connections-dialog">
        <DialogHeader>
          <DialogTitle>Connect your accounts</DialogTitle>
          <DialogDescription>
            Keys are saved in this browser’s local storage and restored after
            reloads and site updates. Local storage is not an encrypted vault.
            Keys and audio are sent through this site to the selected provider
            when you compare.
          </DialogDescription>
        </DialogHeader>
        <p role="status">{storageStatus}</p>
        <div className="key-transfer-actions">
          <Button
            variant="outline"
            disabled={!loaded}
            onClick={() => {
              setTransfer('export');
              setJson(JSON.stringify(keys, null, 2));
              setMessage('');
            }}
          >
            Export API keys
          </Button>
          <Button
            variant="outline"
            disabled={!loaded}
            onClick={() => {
              setTransfer('import');
              setJson('');
              setMessage('');
            }}
          >
            Import API keys
          </Button>
        </div>
        {transfer && (
          <div className="key-transfer">
            <label htmlFor="key-transfer-json">
              {transfer === 'export'
                ? 'Copy this JSON into your 1Password Secure Note.'
                : 'Paste your API keys JSON. Imported providers replace matching keys; other keys are kept.'}
            </label>
            <textarea
              id="key-transfer-json"
              value={json}
              readOnly={transfer === 'export'}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setJson(e.target.value)}
            />
            <div className="key-transfer-actions">
              {transfer === 'export' ? (
                <Button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(json);
                      setMessage('API keys copied.');
                    } catch {
                      setMessage(
                        'Clipboard unavailable. Select the JSON above and copy it manually.',
                      );
                    }
                  }}
                >
                  Copy JSON
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    try {
                      const imported = parseKeys(json);
                      if (!Object.keys(imported).length)
                        throw new Error('No keys found in this backup.');
                      onChange(imported);
                      closeTransfer();
                    } catch (error) {
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : 'Could not import keys.',
                      );
                    }
                  }}
                >
                  Import and save
                </Button>
              )}
              <Button variant="outline" onClick={closeTransfer}>
                Close
              </Button>
            </div>
            <p role="status">{message}</p>
          </div>
        )}
        <div className="key-list">
          {connections.map((c) => (
            <div className="key-field" key={c.id}>
              <div>
                <label htmlFor={'key-' + c.id}>{c.name}</label>
                <a href={c.url} target="_blank" rel="noreferrer">
                  Get a key ↗
                </a>
              </div>
              <Input
                id={'key-' + c.id}
                disabled={!loaded}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={keys[c.id] || ''}
                onChange={(e) => onChange({ [c.id]: e.target.value })}
                placeholder="Paste API key"
              />
              <p>{c.note}</p>
            </div>
          ))}
        </div>
        <div className="dialog-actions">
          <Button
            variant="outline"
            disabled={!loaded}
            onClick={() => {
              onChange({}, true);
              closeTransfer();
            }}
          >
            Forget saved keys
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
