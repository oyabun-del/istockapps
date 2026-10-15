import { useEffect, useState } from 'react';

const TICK_MS = 1000;

function secondsUntil(iso: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / TICK_MS));
}

/** Whole seconds left until `until` (ISO), ticking once a second; 0 when null or past. */
export function useSecondsUntil(until: string | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!until) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [until]);

  return until ? secondsUntil(until, now) : 0;
}
