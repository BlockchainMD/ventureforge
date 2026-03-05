# Prompt Engineering Guide

## Prompt Structure

All prompts are stored as YAML files in `ventureforge/llm/prompts/`. They are never hardcoded in Python.

### YAML Format

```yaml
key: "module.phase.agent"          # Unique registry key
version: 1                          # Increment on changes
model_hint: "deep_reasoning"        # Maps to model via LLM router
system_prompt: |                    # System message
  You are an expert...
  ${lessons}                        # Template variable
user_prompt_template: |             # User message template
  Domain: ${domain}
  Constraints: ${constraints}
  ...
output_schema: "PydanticModelName"  # Expected output type
max_tokens: 4096                    # Token limit
temperature: 0.7                    # Sampling temperature
notes: "Description of changes"     # Change log
```

### Template Variables

Use `${variable_name}` syntax (Python `string.Template`). Variables are passed as kwargs to `render_system()` / `render_user()`.

Common variables:
- `${domain}` - Target domain
- `${constraints}` - User constraints
- `${research_bundle}` - Structured research data
- `${lessons}` - Accumulated lessons from memory
- `${opportunity_title}` - Current opportunity name

## Model Hints

| Hint | Model | Use For |
|------|-------|---------|
| `deep_reasoning` | claude-opus-4-6 | Generation, critique, synthesis |
| `fast_extraction` | claude-sonnet-4-6 | Extraction, summarization, scoring |
| `quantitative` | claude-opus-4-6 | Financial analysis |
| `context_heavy` | claude-opus-4-6 | Full-context tasks |

## Prompt Design Guidelines

### System Prompts
- Define the agent's role and expertise
- Set the tone (e.g., "skeptical VC partner")
- Include `${lessons}` injection point for accumulated insights
- Keep under 500 tokens

### User Prompts
- Provide all context the agent needs
- Be explicit about output format
- Include examples when the expected structure is complex
- Always end with "Return as JSON" + expected shape

### Temperature Guide
- 0.3: Extraction, scoring, factual tasks
- 0.5: Analysis, synthesis
- 0.7: Generation, brainstorming
- Never exceed 0.8

## Versioning System

### How It Works
1. Prompts are loaded from YAML at startup by `PromptRegistry`
2. Each prompt has a `version` field
3. The `MetaAgent` proposes changes after runs
4. Proposed changes create `PromptVersion` records with `status: PENDING`
5. Human reviews via `ventureforge prompts review`
6. On approval, YAML file is updated and old version preserved in DB

### Making Changes
1. Edit the YAML file directly
2. Increment the `version` field
3. Update `notes` with what changed and why
4. Test with `--dry-run` to verify

### Rollback
Old versions are stored in the `prompt_versions` table. To rollback:
1. Find the desired version: `SELECT * FROM prompt_versions WHERE prompt_key = '...'`
2. Copy its content back to the YAML file
3. Update the version number

## Structured Output

All LLM calls request JSON output. The flow:
1. Append JSON instruction to user prompt
2. Parse response, strip any markdown fences
3. Validate against Pydantic model
4. On parse failure, retry up to 3 times with error feedback
