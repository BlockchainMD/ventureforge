import { ConfigurationError } from '@land-alpha/shared';
import { env } from '@land-alpha/shared/env';

/**
 * AI provider abstraction.
 *
 * Model names are never hard-coded in application logic — they come from
 * `AI_MODEL_REASONING` and `AI_MODEL_FAST`, so switching providers or models is
 * a configuration change.
 *
 * The default provider is `fixture`, which needs no credentials and produces
 * deterministic output from the structured data it is given. That is not a stub:
 * because AI is forbidden from being the sole authority for title, access,
 * buildability, zoning, environmental condition or valuation, every number in a
 * memo already comes from a deterministic engine. The fixture provider simply
 * renders those same facts without the prose — which makes it a genuinely
 * useful mode, and makes the whole product runnable with no API key.
 */

export interface CompletionRequest {
  readonly system: string;
  readonly prompt: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  /** Prefer the fast model for extraction and mapping work. */
  readonly tier?: 'reasoning' | 'fast';
}

export interface CompletionResult {
  readonly text: string;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /** True when no external model was called. */
  readonly deterministic: boolean;
}

export interface AiProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

/**
 * Deterministic provider. Returns a marker the callers recognise, so each
 * generator falls back to its own structured renderer rather than emitting
 * placeholder prose that could be mistaken for analysis.
 */
export const DETERMINISTIC_MARKER = '__LAND_ALPHA_DETERMINISTIC__';

export class FixtureProvider implements AiProvider {
  readonly name = 'fixture';

  async complete(): Promise<CompletionResult> {
    return {
      text: DETERMINISTIC_MARKER,
      provider: 'fixture',
      model: 'deterministic',
      inputTokens: null,
      outputTokens: null,
      deterministic: true,
    };
  }
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';

  constructor(private readonly apiKey: string) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const config = env();
    const model = request.tier === 'fast' ? config.AI_MODEL_FAST : config.AI_MODEL_REASONING;
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: this.apiKey });

    const response = await client.messages.create({
      model,
      max_tokens: request.maxTokens ?? config.AI_MAX_OUTPUT_TOKENS,
      temperature: request.temperature ?? config.AI_TEMPERATURE,
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
    });

    // Only text blocks carry output; thinking and tool blocks are discarded.
    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .filter(Boolean)
      .join('\n');

    return {
      text,
      provider: 'anthropic',
      model,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      deterministic: false,
    };
  }
}

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';

  constructor(private readonly apiKey: string) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const config = env();
    const model = request.tier === 'fast' ? config.AI_MODEL_FAST : config.AI_MODEL_REASONING;
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.apiKey });

    const response = await client.chat.completions.create({
      model,
      max_tokens: request.maxTokens ?? config.AI_MAX_OUTPUT_TOKENS,
      temperature: request.temperature ?? config.AI_TEMPERATURE,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.prompt },
      ],
    });

    return {
      text: response.choices[0]?.message?.content ?? '',
      provider: 'openai',
      model,
      inputTokens: response.usage?.prompt_tokens ?? null,
      outputTokens: response.usage?.completion_tokens ?? null,
      deterministic: false,
    };
  }
}

let cached: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (cached) return cached;
  const config = env();

  switch (config.AI_PROVIDER) {
    case 'anthropic':
      if (!config.ANTHROPIC_API_KEY) {
        throw new ConfigurationError('AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY');
      }
      cached = new AnthropicProvider(config.ANTHROPIC_API_KEY);
      break;
    case 'openai':
      if (!config.OPENAI_API_KEY) {
        throw new ConfigurationError('AI_PROVIDER=openai requires OPENAI_API_KEY');
      }
      cached = new OpenAiProvider(config.OPENAI_API_KEY);
      break;
    default:
      cached = new FixtureProvider();
  }
  return cached;
}

export function setAiProvider(provider: AiProvider | null): void {
  cached = provider;
}

/**
 * The system prompt shared by every generator.
 *
 * These constraints are not stylistic. They are the mechanism by which AI is
 * kept from being the sole authority for any determination, and they are
 * repeated in every call rather than assumed.
 */
export const LAND_ALPHA_SYSTEM_PROMPT = `You write for Land Alpha, a land-acquisition intelligence platform used by professional analysts to underwrite government land inventory.

Absolute constraints:
1. Use ONLY the structured facts provided. Never introduce a fact, figure, comparable, measurement or claim that is not in the input.
2. Where the input marks something UNKNOWN, write "UNKNOWN — verification required". Never estimate, infer or fill the gap.
3. Never assert that a parcel is buildable, that legal access exists, that title is clear, that zoning permits a use, or that a parcel is free of environmental problems. These are determinations that only the relevant authority or a licensed professional can make.
4. Every quantitative claim must trace to a provided figure. Do not recompute, round differently, or restate numbers with more precision than given.
5. Cite the evidence identifier in square brackets after any claim that rests on a specific fact, e.g. [acreage].
6. Write plainly and densely, as for a professional investor. No marketing language, no enthusiasm, no hedging filler.

You are producing analysis that a person will risk real money on. Being incomplete is acceptable; being confidently wrong is not.`;
