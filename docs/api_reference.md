# API Reference

VentureForge exposes a REST API via FastAPI. Full OpenAPI spec available at `/docs` when running.

## Base URL

```
http://localhost:8000
```

## Endpoints

### Runs

#### POST /runs/screener
Start a new screener run.

**Request Body:**
```json
{
  "domain": "healthcare operations",
  "constraints": ["B2B only"],
  "anti_patterns": ["no consumer social"],
  "target_funding_stage": "pre-seed to Series A",
  "geography": "US-first",
  "max_candidates": 8,
  "max_rounds_per_phase": 4,
  "quality_threshold": 0.82
}
```

**Response (201):**
```json
{
  "id": "550e8400-...",
  "run_type": "screener",
  "status": "PENDING",
  "created_at": "2025-03-05T10:00:00Z",
  "updated_at": "2025-03-05T10:00:00Z",
  "current_phase": null,
  "current_round": 0,
  "input_config": {...},
  "metadata": {}
}
```

#### POST /runs/builder
Start a new builder run.

**Request Body:**
```json
{
  "opportunity": {
    "title": "...",
    "one_liner": "...",
    "problem_statement": "...",
    "solution_concept": "...",
    "why_now": "...",
    "why_agentic": "...",
    "market_signal": "...",
    "moat_hypothesis": "...",
    "biggest_risk": "...",
    "comparable_companies": ["..."],
    "recommended_first_customer": "..."
  },
  "target_audience": "seed VC",
  "depth": "investor_ready",
  "max_rounds_per_section": 3,
  "quality_threshold": 0.85
}
```

#### GET /runs
List all runs.

**Query params:** `limit` (default 50), `offset` (default 0)

**Response:**
```json
{
  "runs": [...],
  "total": 42
}
```

#### GET /runs/{run_id}
Get full run state.

#### GET /runs/{run_id}/phases
Get all phases for a run.

#### GET /runs/{run_id}/phases/{phase_name}/rounds
Get all rounds for a specific phase.

#### POST /runs/{run_id}/pause
Pause a running run.

#### POST /runs/{run_id}/resume
Resume a paused run.

#### GET /runs/{run_id}/export?format=json|pdf|docx
Export final output. Returns file download.

#### DELETE /runs/{run_id}
Soft-delete a run.

### Opportunities

#### GET /opportunities
List all opportunities in the knowledge base.

**Response:**
```json
[
  {
    "id": "...",
    "title": "...",
    "composite_score": 0.85,
    "status": "selected",
    "problem_space": "..."
  }
]
```

### Lessons

#### GET /lessons
List all accumulated lessons.

### Prompts

#### POST /prompts/{key}/approve
Approve a pending prompt version update.

## Error Responses

All errors follow this format:
```json
{
  "detail": "Error description"
}
```

Common status codes:
- 400: Invalid request
- 404: Resource not found
- 422: Validation error
- 500: Internal server error
