'use client';
import { useEffect, useRef, useState } from 'react';
import { AUTH_PENDING, validateCallback } from '@/lib/openrouter-auth';
import { mergeSavedKeys } from '@/lib/key-storage';
export default function Callback() {
  const began = useRef(false);
  const [message, setMessage] = useState('Connecting OpenRouter…');
  useEffect(() => {
    if (began.current) return;
    began.current = true;
    void (async () => {
      try {
        const body = validateCallback(
          location.search,
          sessionStorage.getItem(AUTH_PENDING),
        );
        history.replaceState(null, '', location.pathname);
        sessionStorage.removeItem(AUTH_PENDING);
        const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
          redirect: 'error',
        });
        const data = (await response.json()) as { key?: string };
        if (!response.ok || typeof data.key !== 'string' || data.key.length < 8)
          throw new Error(
            'OpenRouter could not complete the connection. Close this window and try connecting again.',
          );
        mergeSavedKeys(localStorage, { openrouter: data.key });
        setMessage(
          'OpenRouter connected. You can close this window and return to your recording.',
        );
        window.close();
      } catch (error) {
        history.replaceState(null, '', location.pathname);
        setMessage(
          error instanceof Error
            ? error.message
            : 'Could not connect OpenRouter. Please try again.',
        );
      }
    })();
  }, []);
  return (
    <main className="lab">
      <section className="intro">
        <div>
          <h1>Voxbench</h1>
          <p role="status">{message}</p>
          <a href="/">Return to Voxbench</a>
        </div>
      </section>
    </main>
  );
}
