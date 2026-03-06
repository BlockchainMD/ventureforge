import { useCallback } from "react";
import { listLessons } from "@/api/client";
import { usePolling } from "./usePolling";

export function useLessons() {
  const fetcher = useCallback(() => listLessons(), []);
  return usePolling(fetcher, 30000, false);
}
