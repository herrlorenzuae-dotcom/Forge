import { useEffect, useState } from 'react';

/**
 * A clean splash: the DraftBase wordmark on the app canvas, held for a
 * beat, then fades into the workspace. Click to skip; reduced-motion users
 * go straight in; plays once per session.
 */

const HOLD_MS = 900;
const FADE_MS = 700;

function introParam(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('intro');
}

export function shouldPlayIntro(): boolean {
  if (typeof window === 'undefined') return false;
  if (introParam()) return true; // ?intro=1 replays, ?intro=hold freezes
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return sessionStorage.getItem('draftbase-intro-seen') !== '1';
}

export function Intro({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    sessionStorage.setItem('draftbase-intro-seen', '1');
    if (introParam() === 'hold') return; // frozen for inspection; click to dismiss
    const t = setTimeout(() => setLeaving(true), HOLD_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => {
      setGone(true);
      onDone();
    }, FADE_MS);
    return () => clearTimeout(t);
  }, [leaving, onDone]);

  if (gone) return null;

  return (
    <div
      className={`splash-veil fixed inset-0 z-50 flex cursor-pointer items-center justify-center ${leaving ? 'opacity-0' : 'opacity-100'}`}
      onClick={() => setLeaving(true)}
      role="presentation"
      aria-hidden="true"
    >
      <div className="intro-mark flex items-baseline gap-2.5">
        <span className="text-2xl font-bold tracking-tight text-fog">YPOG</span>
        <span className="h-6 w-px translate-y-1 bg-black/15" />
        <span className="text-3xl font-bold tracking-tight text-bone">DraftBase</span>
      </div>
    </div>
  );
}
