import { useCallback, useMemo } from "react";
import { getRun } from "@/api/client";
import { usePolling } from "./usePolling";

export function useRun(id: string) {
  const fetcher = useCallback(() => getRun(id), [id]);
  const isActive = (status: string) =>
    status === "RUNNING" || status === "PENDING";

  const { data, error, loading, refetch } = usePolling(fetcher, 3000, true);

  const polling = useMemo(
    () => (data ? isActive(data.status) : true),
    [data]
  );

  return { run: data, error, loading, polling, refetch };
}
