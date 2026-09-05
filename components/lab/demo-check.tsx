'use client';
/* oxlint-disable react/set-state-in-effect -- Reset UI/token state when mounting the external verification widget. */
import { useEffect, useRef, useState } from 'react';
type WidgetAPI = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: WidgetAPI;
  }
}
let loadWidget: Promise<void> | undefined;
function load() {
  if (window.turnstile) return Promise.resolve();
  return (loadWidget ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src =
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loadWidget = undefined;
      script.remove();
      reject(new Error('Could not load the verification checkbox.'));
    };
    document.head.appendChild(script);
  }));
}
export function DemoCheck({
  siteKey,
  reset,
  onToken,
}: {
  siteKey: string;
  reset: number;
  onToken: (token: string) => void;
}) {
  const target = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false,
      widget: string | undefined;
    onToken('');
    setError('');
    void load()
      .then(() => {
        if (cancelled || !target.current || !window.turnstile) return;
        widget = window.turnstile.render(target.current, {
          sitekey: siteKey,
          action: 'voxbench-demo',
          theme: 'light',
          size: 'flexible',
          callback: (token: string) => onToken(token),
          'expired-callback': () => onToken(''),
          'error-callback': () => {
            onToken('');
            setError(
              'Verification failed. Reload the page or use your own OpenRouter account.',
            );
          },
        });
      })
      .catch(() =>
        setError(
          'Could not load verification. Check your connection or use your own OpenRouter account.',
        ),
      );
    return () => {
      cancelled = true;
      if (widget) window.turnstile?.remove(widget);
    };
  }, [siteKey, reset, onToken]);
  return (
    <div className="demo-verification">
      <div ref={target} />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
