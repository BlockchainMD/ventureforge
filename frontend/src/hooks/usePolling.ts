import { useEffect, useRef, useCallback, useState } from "react";

export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  enabled: boolean
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const backoffRef = useRef(intervalMs);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const doFetch = useCallback(async () => {
    try {
      const result = await fetcher();
      setData(result);
      setError(null);
      backoffRef.current = intervalMs;
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      backoffRef.current = Math.min(backoffRef.current * 2, 30000);
    } finally {
      setLoading(false);
    }
  }, [fetcher, intervalMs]);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  useEffect(() => {
    if (!enabled) return;
    const schedule = () => {
      timerRef.current = setTimeout(async () => {
        await doFetch();
        schedule();
      }, backoffRef.current);
    };
    schedule();
    return () => clearTimeout(timerRef.current);
  }, [enabled, doFetch]);

  const refetch = useCallback(() => {
    setLoading(true);
    doFetch();
  }, [doFetch]);

  return { data, error, loading, refetch };
}
