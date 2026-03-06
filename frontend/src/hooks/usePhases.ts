import { useCallback } from "react";
import { getPhases } from "@/api/client";
import { usePolling } from "./usePolling";

export function usePhases(runId: string, active: boolean) {
  const fetcher = useCallback(() => getPhases(runId), [runId]);
  return usePolling(fetcher, 3000, active);
}
