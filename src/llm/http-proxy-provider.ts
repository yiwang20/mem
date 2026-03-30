/**
 * HttpProxyProvider — LLM provider that delegates to an external HTTP endpoint.
 *
 * Designed to let MindFlow reuse x-agent's LLM gateway via its /llm/complete
 * endpoint, avoiding the need for separate API keys or LLM client configuration.
 */

import type {
  AnswerContext,
  AnswerResult,
  ExtractionContext,
  ExtractionResult,
  LLMProvider,
} from '../types/index.js';
import { buildExtractionPrompt, buildAnswerPrompt } from './prompts.js';

export class HttpProxyProvider implements LLMProvider {
  readonly name = 'http-proxy';

  constructor(private readonly endpoint: string) {}

  async extract(content: string, context?: ExtractionContext): Promise<ExtractionResult> {
    const prompt = buildExtractionPrompt(content, context);
    const raw = await this.complete(prompt);

    try {
      const parsed = JSON.parse(raw);
      return {
        entities: parsed.entities ?? [],
        relationships: parsed.relationships ?? [],
        summary: parsed.summary ?? '',
        language: parsed.language ?? null,
      };
    } catch {
      return { entities: [], relationships: [], summary: '', language: null };
    }
  }

  async answer(query: string, context: AnswerContext): Promise<AnswerResult> {
    const prompt = buildAnswerPrompt(query, context);
    const raw = await this.complete(prompt);

    try {
      const parsed = JSON.parse(raw);
      return {
        answer: parsed.answer ?? raw,
        sourceItemIds: (parsed.sourceIndices ?? []).map(
          (i: number) => context.relevantItems[i]?.id,
        ).filter(Boolean),
        confidence: parsed.confidence ?? 0.5,
      };
    } catch {
      return { answer: raw, sourceItemIds: [], confidence: 0.5 };
    }
  }

  async embed(_text: string): Promise<Float64Array> {
    // Embeddings not supported via HTTP proxy; return zero vector
    return new Float64Array(1024);
  }

  async embedBatch(texts: string[]): Promise<Float64Array[]> {
    return texts.map(() => new Float64Array(1024));
  }

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(this.endpoint.replace('/llm/complete', '/health'), {
        signal: AbortSignal.timeout(3000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  private async complete(prompt: string): Promise<string> {
    const resp = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!resp.ok) {
      throw new Error(`LLM proxy error: ${resp.status} ${await resp.text()}`);
    }

    const data = (await resp.json()) as { content?: string };
    return data.content ?? '';
  }
}
