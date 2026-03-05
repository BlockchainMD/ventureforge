# VentureForge Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      CLI / REST API                              │
│  (Typer CLI)              (FastAPI + WebSocket)                  │
└────────────┬──────────────────────┬─────────────────────────────┘
             │                      │
             ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Orchestrator Engine                            │
│  ┌──────────┐  ┌──────────────┐  ┌─────────────┐               │
│  │  Runner   │  │ Deliberation │  │ Checkpointer│               │
│  │          │  │    Loop      │  │             │               │
│  └──────────┘  └──────────────┘  └─────────────┘               │
└────────────┬──────────────────────┬─────────────────────────────┘
             │                      │
     ┌───────┴───────┐      ┌──────┴──────┐
     ▼               ▼      ▼             ▼
┌──────────┐  ┌──────────┐ ┌──────────┐ ┌──────────┐
│ Screener │  │ Builder  │ │  Agents  │ │ Scoring  │
│ Pipeline │  │ Pipeline │ │          │ │ Engine   │
└──────────┘  └──────────┘ └──────────┘ └──────────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │   LLM    │ │ Research │ │  Memory  │
              │  Router  │ │  Engine  │ │   Store  │
              └──────────┘ └──────────┘ └──────────┘
                    │           │
              ┌─────┴─────┐    │
              ▼           ▼    ▼
         ┌─────────┐ ┌──────┐ ┌────────┐
         │Anthropic│ │OpenAI│ │ Tavily │
         │   API   │ │  API │ │  API   │
         └─────────┘ └──────┘ └────────┘
```

## Module Descriptions

### Core (`ventureforge/core/`)
Foundation layer. Contains configuration, database setup, ORM models, Pydantic schemas, state machine, and exception hierarchy. All other modules depend on core; core depends on nothing internal.

### Orchestrator (`ventureforge/orchestrator/`)
The execution engine. The **Runner** creates runs and drives phase sequences. The **DeliberationLoop** runs multi-round agent cycles within each phase. The **Checkpointer** persists every round to the database for crash recovery. The **Router** defines agent sequences and phase configurations.

### Agents (`ventureforge/agents/`)
Individual agent implementations. Each agent extends `BaseAgent` and implements `run()` and `_get_dry_run_output()`. Agents are stateless - all state flows through `RoundContext`.

Agent execution order per round:
1. **Researcher** - gathers live web data
2. **Generator** - produces content using enriched context
3. **Critic** - adversarially attacks generated content
4. **Synthesizer** - integrates critique into refined output
5. **Scorer** - evaluates output, recommends loop/advance/escalate
6. **ConsistencyChecker** (builder only) - validates cross-section coherence

### Screener (`ventureforge/screener/`)
Business opportunity screening pipeline. Four phases: Horizon Scan (breadth), Deep Dive (depth), Gap Analysis (white space), Final Ranking (thesis).

### Builder (`ventureforge/builder/`)
Business blueprint builder. Builds 11 sections sequentially with consistency checks at defined checkpoints.

### LLM (`ventureforge/llm/`)
LLM abstraction layer. Routes calls to appropriate models based on task type. Manages prompt templates via YAML registry with versioning. Handles rate limiting and retries.

### Research (`ventureforge/research/`)
Web research orchestration. Tavily for search, optional Crunchbase for funding data. Results cached with configurable TTL. Synthesizer converts raw results into structured insights.

### Scoring (`ventureforge/scoring/`)
Rubric-based output evaluation. Each phase has defined scoring dimensions with weights. Evaluator uses LLM to score against rubrics. Calibrator proposes weight adjustments from feedback.

### Memory (`ventureforge/memory/`)
Persistent knowledge store. Tracks all opportunities, accumulated lessons, and optional vector embeddings for semantic search.

### Output (`ventureforge/output/`)
Document rendering and export. Supports JSON, PDF (reportlab), and DOCX (python-docx) formats.

## Data Flow

### Screener Flow
```
ScreenerInput → Runner.create_run()
  → Phase 1: Horizon Scan (generate 25 candidates → shortlist 8)
  → Phase 2: Deep Dive (research each of 8 in parallel)
  → Phase 3: Gap Analysis (white space scoring)
  → Phase 4: Final Ranking (produce OpportunityThesis)
→ Persist opportunities + thesis
```

### Builder Flow
```
BuilderInput (with OpportunityThesis) → Runner.create_run()
  → For each of 11 sections (sequential):
    → DeliberationLoop(agents=[researcher, generator, critic, synthesizer, scorer, consistency_checker])
    → Lock section when quality threshold met
    → Full consistency check at sections 5, 8, 11
  → Assemble blueprint
  → Export PDF/DOCX/JSON
```

## Dependency Direction
```
core → (no internal deps)
utils → core
llm → core, utils
research → core, llm, utils
scoring → core, llm, utils
memory → core, utils
agents → core, llm, research, scoring, utils
orchestrator → core, agents, utils
screener → core, orchestrator, agents, utils
builder → core, orchestrator, agents, utils
output → core, builder, utils
api → core, screener, builder, output, utils
main → core, screener, builder, output, utils
```

No circular imports. No upward dependencies.
