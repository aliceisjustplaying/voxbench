'use client';
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
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  keys: Keys;
  onChange: (keys: Keys) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="connections-dialog">
        <DialogHeader>
          <DialogTitle>Connect your accounts</DialogTitle>
          <DialogDescription>
            Keys stay in this tab’s memory and are sent through this site to the
            selected provider. Reloading clears them. Recording starts locally;
            audio is sent only when you compare.
          </DialogDescription>
        </DialogHeader>
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
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={keys[c.id] || ''}
                onChange={(e) => onChange({ ...keys, [c.id]: e.target.value })}
                placeholder="Paste API key"
              />
              <p>{c.note}</p>
            </div>
          ))}
        </div>
        <div className="dialog-actions">
          <Button variant="outline" onClick={() => onChange({})}>
            Clear all keys
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
