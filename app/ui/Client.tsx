'use client';

import { useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';

/** Keeps dashboards live: refetches server data every `seconds` while the tab is visible. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') router.refresh(); };
    const id = setInterval(tick, seconds * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [router, seconds]);
  return null;
}

/** Submit button that shows a spinner (and blocks double taps) while its form's action runs. */
export function Submit({ children, className = '', pendingLabel, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { pendingLabel?: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button {...rest} className={`${className} ${pending ? 'pending' : ''}`} aria-busy={pending} disabled={rest.disabled || pending}>
      {pending ? <><span className="spinner" aria-hidden />{pendingLabel ?? children}</> : children}
    </button>
  );
}

/** Fades the action message out after a few seconds and drops ?msg from the URL. */
export function Toast({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('msg')) {
      url.searchParams.delete('msg');
      url.searchParams.delete('mv');
      window.history.replaceState(window.history.state, '', url.pathname + url.search);
    }
    const id = setTimeout(() => ref.current?.classList.add('hide'), 5000);
    return () => clearTimeout(id);
  }, []);
  return <div ref={ref} className="msg" role="status">{children}</div>;
}
