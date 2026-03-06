import type {
  RunResponse,
  RunListResponse,
  PhaseResponse,
  RoundResponse,
  ScreenerInput,
  BuilderInput,
  OpportunityBrief,
  LessonResponse,
} from "./types";

const BASE = "";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

// --- Runs ---

export async function listRuns(
  limit = 50,
  offset = 0
): Promise<RunListResponse> {
  return request(`/runs?limit=${limit}&offset=${offset}`);
}

export async function getRun(id: string): Promise<RunResponse> {
  return request(`/runs/${id}`);
}

export async function startScreener(
  input: ScreenerInput
): Promise<RunResponse> {
  return request("/runs/screener", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function startBuilder(input: BuilderInput): Promise<RunResponse> {
  return request("/runs/builder", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function pauseRun(id: string): Promise<{ status: string }> {
  return request(`/runs/${id}/pause`, { method: "POST" });
}

export async function resumeRun(id: string): Promise<{ status: string }> {
  return request(`/runs/${id}/resume`, { method: "POST" });
}

export async function deleteRun(id: string): Promise<{ status: string }> {
  return request(`/runs/${id}`, { method: "DELETE" });
}

// --- Phases & Rounds ---

export async function getPhases(runId: string): Promise<PhaseResponse[]> {
  return request(`/runs/${runId}/phases`);
}

export async function getRounds(
  runId: string,
  phaseName: string
): Promise<RoundResponse[]> {
  return request(`/runs/${runId}/phases/${phaseName}/rounds`);
}

// --- Export ---

export function getExportUrl(runId: string, format: "json" | "pdf" | "docx") {
  return `${BASE}/runs/${runId}/export?format=${format}`;
}

// --- Opportunities ---

export async function listOpportunities(): Promise<OpportunityBrief[]> {
  return request("/opportunities");
}

// --- Lessons ---

export async function listLessons(): Promise<LessonResponse[]> {
  return request("/lessons");
}
