'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AUTH_PENDING, authorizationRequest } from '@/lib/openrouter-auth';
export function OpenRouterConnect() {
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  async function connect() {
    setError('');
    const popup = window.open(
      'about:blank',
      '_blank',
      'popup,width=580,height=760',
    );
    if (!popup) {
      setError('Allow pop-ups to connect OpenRouter.');
      return;
    }
    setConnecting(true);
    try {
      const { url, pending } = await authorizationRequest(
        window.location.origin,
      );
      // Store in the same-origin popup, preserving the recording in this tab.
      popup.sessionStorage.setItem(AUTH_PENDING, JSON.stringify(pending));
      popup.location.replace(url);
    } catch {
      popup.close();
      setError(
        'Could not open OpenRouter. Check that browser storage is available.',
      );
    } finally {
      setConnecting(false);
    }
  }
  return (
    <div className="openrouter-connect">
      <Button disabled={connecting} onClick={connect}>
        Continue with OpenRouter ↗
      </Button>
      <p>Approve access to your OpenRouter balance. No key to copy.</p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
