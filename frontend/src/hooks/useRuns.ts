import { useCallback, useMemo } from "react";
import { listRuns } from "@/api/client";
import { usePolling } from "./usePolling";

export function useRuns() {
  const fetcher = useCallback(() => listRuns(), []);
  const { data, error, loading, refetch } = usePolling(fetcher, 5000, true);

  const hasActive = useMemo(
    () =>
      data?.runs.some((r) => r.status === "RUNNING" || r.status === "PENDING") ??
      false,
    [data]
  );

  return {
    runs: data?.runs ?? [],
    total: data?.total ?? 0,
    hasActive,
    error,
    loading,
    refetch,
  };
}
