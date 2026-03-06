export interface RunResponse {
  id: string;
  run_type: "screener" | "builder";
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "PAUSED";
  created_at: string;
  updated_at: string;
  current_phase: string | null;
  current_round: number;
  input_config: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface RunListResponse {
  runs: RunResponse[];
  total: number;
}

export interface PhaseResponse {
  id: string;
  phase_name: string;
  status: string;
  round_count: number;
  quality_score: number | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface RoundResponse {
  id: string;
  round_number: number;
  scores: Record<string, unknown>;
  decision: string | null;
  decision_rationale: string | null;
  duration_seconds: number | null;
}

export interface ScreenerInput {
  domain?: string;
  constraints?: string[];
  anti_patterns?: string[];
  target_funding_stage?: string;
  geography?: string;
  exclude_opportunity_ids?: string[];
  max_candidates?: number;
  max_rounds_per_phase?: number;
  quality_threshold?: number;
}

export interface OpportunityThesis {
  title: string;
  one_liner: string;
  problem_statement: string;
  solution_concept: string;
  why_now: string;
  why_agentic: string;
  market_signal: string;
  moat_hypothesis: string;
  biggest_risk: string;
  comparable_companies?: string[];
  recommended_first_customer?: string;
}

export interface BuilderInput {
  opportunity: OpportunityThesis;
  founder_context?: string;
  capital_constraints?: string;
  target_audience?: string;
  depth?: "mvp" | "full" | "investor_ready";
  max_rounds_per_section?: number;
  quality_threshold?: number;
}

export interface OpportunityBrief {
  id: string;
  title: string;
  composite_score: number;
  status: string;
  problem_space: string;
}

export interface LessonResponse {
  id: string;
  category: string;
  insight: string;
  applies_to: string[];
  created_at: string;
}
