# VentureForge

An enterprise-grade agentic AI system that screens the market for untapped business opportunities and builds investment-ready business blueprints.

## What It Does

**Business Screener** - Multi-phase pipeline that:
1. Generates 20-30 candidate problem spaces via horizon scanning
2. Deep-dives into the top 8 with live web research
3. Analyzes white space and AI moat potential
4. Produces a ranked list with a full opportunity thesis

**Business Builder** - Produces an 11-section blueprint:
Problem Statement, Solution Architecture, Market Sizing, Competitive Landscape, Business Model, Go-To-Market, Tech Stack, Team Profile, Financial Projections, Risk Register, Pitch Narrative

Each section goes through multi-round deliberation with adversarial critique from simulated VC partners, scoring against rubrics, and cross-section consistency checks.

## Quickstart

```bash
# 1. Clone and install
git clone <repo-url> && cd ventureforge
pip install -e ".[dev]"

# 2. Configure
cp .env.example .env
# Edit .env with your API keys (or skip for dry-run mode)

# 3. Initialize database
ventureforge db init

# 4. Run screener (dry-run, no API keys needed)
ventureforge screen --domain "B2B SaaS operations" --dry-run

# 5. Run builder (dry-run)
ventureforge build --thesis tests/fixtures/sample_opportunity.json --dry-run
```

## Architecture

```
CLI / REST API
    │
    ▼
Orchestrator Engine (Runner → Deliberation Loop → Checkpointer)
    │
    ├── Screener Pipeline (4 phases)
    ├── Builder Pipeline (11 sections)
    │
    ▼
Agents: Generator → Researcher → Critic → Synthesizer → Scorer
    │
    ├── LLM Router (Anthropic Claude, OpenAI)
    ├── Research Engine (Tavily web search)
    ├── Scoring Engine (rubric-based evaluation)
    └── Memory Store (knowledge base + lessons)
```

Every round is persisted to the database. Runs can be paused, resumed, and exported at any time.

See [docs/architecture.md](docs/architecture.md) for full details.

## Configuration

All settings via environment variables or `.env` file:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes* | - | Claude API key |
| `TAVILY_API_KEY` | Yes* | - | Tavily search API key |
| `OPENAI_API_KEY` | No | - | OpenAI API key (optional) |
| `DATABASE_URL` | No | `sqlite:///./ventureforge.db` | Database connection |
| `DEFAULT_MAX_ROUNDS` | No | 4 | Max deliberation rounds |
| `DEFAULT_QUALITY_THRESHOLD` | No | 0.82 | Score to advance |
| `DEEP_REASONING_MODEL` | No | `claude-opus-4-6` | Heavy reasoning model |
| `FAST_MODEL` | No | `claude-sonnet-4-6` | Fast extraction model |
| `OUTPUT_DIR` | No | `./outputs` | Export directory |

*Not required for `--dry-run` mode.

## CLI Commands

```bash
ventureforge screen --domain "..." [--max-candidates 8] [--dry-run]
ventureforge build --thesis path/to/thesis.json [--dry-run]
ventureforge runs list
ventureforge runs show <run_id>
ventureforge runs export <run_id> --format pdf
ventureforge prompts review
ventureforge db init
```

## REST API

```bash
# Start the API server
uvicorn ventureforge.api:app --host 0.0.0.0 --port 8000

# Or with Docker
docker compose up
```

API docs at `http://localhost:8000/docs`

Key endpoints:
- `POST /runs/screener` - Start screener
- `POST /runs/builder` - Start builder
- `GET /runs/{id}` - Run status
- `GET /runs/{id}/export?format=pdf` - Export results
- `GET /opportunities` - Knowledge base

## Docker

```bash
docker compose up        # Start API + Postgres + Redis
docker compose up -d     # Detached mode
```

## Testing

```bash
pytest                           # Run all tests
pytest --cov=ventureforge        # With coverage
pytest tests/unit/               # Unit tests only
pytest tests/integration/        # Integration tests only
```

## Project Structure

```
ventureforge/
├── core/           # Config, DB, models, schemas, state machine
├── orchestrator/   # Runner, deliberation loop, checkpointer
├── agents/         # All agent implementations
├── screener/       # Screener pipeline phases
├── builder/        # Builder pipeline + 11 sections
├── llm/            # LLM routing, clients, prompt registry
├── research/       # Web research engine
├── scoring/        # Rubrics and evaluation
├── memory/         # Knowledge base and lessons
├── output/         # PDF, DOCX, JSON exporters
└── utils/          # Logging, retry, token counting
```

## Documentation

- [Architecture](docs/architecture.md)
- [State Schema](docs/state_schema.md)
- [Agent Guide](docs/agent_guide.md)
- [Prompt Engineering](docs/prompt_engineering.md)
- [API Reference](docs/api_reference.md)

## Key Design Decisions

- **Deliberation loops**: Every phase runs multi-round cycles with adversarial critique, not single-shot generation
- **Typed outputs**: All agent outputs parsed into Pydantic models, never raw strings
- **Full auditability**: Every round persisted before the next begins
- **Resumability**: Runs can be paused/resumed from any checkpoint
- **Self-improvement**: Meta-agent writes lessons and proposes prompt updates
- **Dry-run mode**: Full pipeline runs with zero API calls for testing

## License

Proprietary. All rights reserved.
