import { useCallback } from "react";
import { listOpportunities } from "@/api/client";
import { usePolling } from "./usePolling";

export function useOpportunities() {
  const fetcher = useCallback(() => listOpportunities(), []);
  return usePolling(fetcher, 30000, false);
}
