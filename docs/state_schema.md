# State Schema Documentation

## ORM Models

### Run
Top-level record for any screener or builder execution.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID (str) | Primary key |
| run_type | str | "screener" or "builder" |
| status | RunStatus enum | PENDING, RUNNING, PAUSED, COMPLETED, FAILED |
| created_at | datetime | Auto-set on creation |
| updated_at | datetime | Auto-updated on changes |
| input_config | JSON dict | The seed input configuration |
| current_phase | str | Currently executing phase name |
| current_round | int | Current round number |
| metadata_ | JSON dict | Extra context |
| is_deleted | bool | Soft delete flag |

### Phase
A phase within a run (e.g., horizon_scan, problem_statement).

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| run_id | UUID (FK) | Parent run |
| phase_name | str | e.g. "horizon_scan", "market_sizing" |
| status | PhaseStatus | PENDING, RUNNING, COMPLETED, FAILED, SKIPPED |
| started_at | datetime | When phase started |
| completed_at | datetime | When phase finished |
| round_count | int | Total rounds executed |
| final_output | JSON dict | Accepted final output |
| quality_score | float | Score that triggered advancement |

### Round
A single deliberation round within a phase.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| phase_id | UUID (FK) | Parent phase |
| round_number | int | 1-indexed round number |
| agent_outputs | JSON dict | Map of agent_name -> output |
| research_citations | JSON list | Sources consulted |
| scores | JSON dict | Dimension -> score mapping |
| critique_summary | str | What the critic found |
| decision | str | "loop", "advance", or "escalate" |
| decision_rationale | str | Why this decision |
| token_usage | JSON dict | Tokens per model |
| duration_seconds | float | Wall clock time |

### Opportunity
A candidate business opportunity from the screener.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| run_id | UUID (FK) | Parent run |
| title | str | Opportunity title |
| phase_introduced | str | Which phase surfaced this |
| problem_space | str | Problem description |
| target_customer | str | Target customer persona |
| ai_moat_description | str | Why AI is the moat |
| scores | JSON dict | Scoring dimensions |
| composite_score | float | Weighted score (0-1) |
| research_data | JSON dict | All research gathered |
| status | OpportunityStatus | candidate, shortlisted, selected, eliminated |
| elimination_reason | str | Why eliminated (if applicable) |
| opportunity_thesis | str | 3-sentence thesis |

### BlueprintSection
A section of the builder blueprint.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| run_id | UUID (FK) | Parent run |
| section_name | str | e.g. "market_sizing" |
| section_order | int | Build order (1-11) |
| content | JSON dict | Structured content |
| plain_text | str | Human-readable version |
| quality_score | float | Final quality score |
| revision_count | int | Number of rounds |
| vc_critique | str | Final critique |
| is_locked | bool | True once accepted |

### PromptVersion
Versioned prompt record.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| prompt_key | str | Registry key |
| version | int | Version number |
| content | str | Full prompt content |
| performance_metrics | JSON dict | How this version performed |
| created_from_run_id | UUID | Which run spawned this |
| status | str | active, pending, retired |

### Lesson
Accumulated insight from meta-agent retrospectives.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| source_run_id | UUID | Which run generated this |
| category | str | e.g. "market_sizing" |
| insight | str | The lesson text |
| applies_to | JSON list | Which run types benefit |

## State Machine

```
   ┌──────────┐
   │ PENDING  │
   └────┬─────┘
        │ start_run()
        ▼
   ┌──────────┐
   │ RUNNING  │◄──────┐
   └────┬─────┘       │
        │             │ resume_run()
   ┌────┼─────┐       │
   │    │     │  ┌────┴─────┐
   │    │     └─►│  PAUSED  │
   │    │        └──────────┘
   │    │
   │    ▼
   │ ┌──────────┐
   │ │COMPLETED │
   │ └──────────┘
   │
   ▼
┌──────────┐
│  FAILED  │
└──────────┘
```

Valid transitions:
- PENDING -> RUNNING
- RUNNING -> PAUSED, COMPLETED, FAILED
- PAUSED -> RUNNING, FAILED

Every transition is logged in `state_transition_logs` with timestamp and reason.

## Example Run Record (JSON)

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "run_type": "screener",
  "status": "COMPLETED",
  "created_at": "2025-03-05T10:00:00Z",
  "updated_at": "2025-03-05T10:15:30Z",
  "input_config": {
    "domain": "healthcare operations",
    "constraints": ["B2B only"],
    "max_candidates": 8,
    "quality_threshold": 0.82
  },
  "current_phase": "final_ranking",
  "current_round": 2,
  "metadata": {}
}
```
