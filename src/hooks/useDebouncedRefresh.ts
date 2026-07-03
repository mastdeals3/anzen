import { useEffect, useMemo, useRef } from 'react';

/**
 * Returns a stable debounced function. On unmount clears the pending timer.
 * Latest fn body is captured via ref so callers can close over fresh state.
 */
export function useDebouncedRefresh(fn: () => void | Promise<void>, delayMs = 250): () => void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );
  return useMemo(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void fnRef.current();
      }, delayMs);
    },
    [delayMs]
  );
}
