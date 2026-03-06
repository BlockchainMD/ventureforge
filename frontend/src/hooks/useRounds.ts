import { useCallback } from "react";
import { getRounds } from "@/api/client";
import { usePolling } from "./usePolling";

export function useRounds(runId: string, phaseName: string, active: boolean) {
  const fetcher = useCallback(
    () => getRounds(runId, phaseName),
    [runId, phaseName]
  );
  return usePolling(fetcher, 3000, active);
}
