import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type {
  AnswerContext,
  AnswerResult,
  ExtractionContext,
  ExtractionResult,
  LLMProvider,
} from '../types/index.js';
import { DetectedLanguage, EntityType, RelationshipType } from '../types/index.js';
import {
  buildAnswerPrompt,
  buildExtractionPrompt,
} from './prompts.js';

// ---------------------------------------------------------------------------
// Zod schemas for LLM output validation
// ---------------------------------------------------------------------------

const ExtractedEntitySchema = z
  .object({
    type: z.nativeEnum(EntityType),
    name: z.string().min(1),
    nameAlt: z.string().nullable().optional(),
    attributes: z.record(z.unknown()).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .transform(
    (v): import('../types/index.js').ExtractedEntity => ({
      type: v.type,
      name: v.name,
      nameAlt: v.nameAlt ?? null,
      attributes: v.attributes ?? {},
      confidence: v.confidence ?? 0.8,
    }),
  );

const ExtractedRelationshipSchema = z
  .object({
    fromEntityName: z.string().min(1),
    toEntityName: z.string().min(1),
    type: z.nativeEnum(RelationshipType),
    strength: z.number().min(0).max(1).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .transform(
    (v): import('../types/index.js').ExtractedRelationship => ({
      fromEntityName: v.fromEntityName,
      toEntityName: v.toEntityName,
      type: v.type,
      strength: v.strength ?? 0.5,
      metadata: v.metadata ?? {},
    }),
  );

const ExtractionOutputSchema = z
  .object({
    entities: z.array(ExtractedEntitySchema).optional(),
    relationships: z.array(ExtractedRelationshipSchema).optional(),
    summary: z.string().nullable().optional(),
    language: z.nativeEnum(DetectedLanguage).optional(),
  })
  .transform((v): ExtractionResult => ({
    entities: v.entities ?? [],
    relationships: v.relationships ?? [],
    summary: v.summary ?? null,
    language: v.language ?? DetectedLanguage.English,
  }));

const AnswerOutputSchema = z
  .object({
    answer: z.string(),
    sourceIndices: z.array(z.number()).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .transform((v) => ({
    answer: v.answer,
    sourceIndices: v.sourceIndices ?? ([] as number[]),
    confidence: v.confidence ?? 0.7,
  }));

// ---------------------------------------------------------------------------
// Helper: parse LLM JSON output safely
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJsonOutput<S extends z.ZodTypeAny>(raw: string, schema: S): z.output<S> {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const parsed: unknown = JSON.parse(cleaned);
  return schema.parse(parsed) as z.output<S>;
}

// ---------------------------------------------------------------------------
// ClaudeProvider
// ---------------------------------------------------------------------------

export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude';

  private readonly client: Anthropic;
  private readonly model: string;
  private readonly embeddingModel: string;

  constructor(config: {
    apiKey?: string;
    model?: string;
    embeddingModel?: string;
  } = {}) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model ?? 'claude-opus-4-6';
    this.embeddingModel = config.embeddingModel ?? 'voyage-3';
  }

  async extract(
    content: string,
    context?: ExtractionContext,
  ): Promise<ExtractionResult> {
    const prompt = buildExtractionPrompt(content, context);

    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return emptyExtractionResult();
    }

    return parseJsonOutput(textBlock.text, ExtractionOutputSchema);
  }

  async answer(query: string, context: AnswerContext): Promise<AnswerResult> {
    const itemSummaries = context.relevantItems.map(
      (item) =>
        `[${item.id}] ${item.subject ?? '(no subject)'}: ${item.body.slice(0, 300)}`,
    );
    const entitySummaries = context.relevantEntities.map(
      (e) => `${e.canonicalName} (${e.type})`,
    );

    const prompt = buildAnswerPrompt(query, itemSummaries, entitySummaries);

    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { answer: 'Unable to generate an answer.', sourceItemIds: [], confidence: 0 };
    }

    const output = parseJsonOutput(textBlock.text, AnswerOutputSchema);
    const sourceItemIds = output.sourceIndices
      .map((i) => context.relevantItems[i - 1]?.id)
      .filter((id): id is string => id !== undefined);

    return {
      answer: output.answer,
      sourceItemIds,
      confidence: output.confidence,
    };
  }

  async embed(text: string): Promise<Float64Array> {
    // Claude/Anthropic does not expose a first-party embedding API;
    // we delegate to the Voyage API via the Anthropic client.
    // If the environment has no embedding support, return a zero vector.
    // TODO: integrate voyage embeddings when available
    void text;
    void this.embeddingModel;
    return new Float64Array(1536);
  }

  async embedBatch(texts: string[]): Promise<Float64Array[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// OllamaProvider
// ---------------------------------------------------------------------------

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly embeddingModel: string;

  constructor(config: {
    baseUrl?: string;
    model?: string;
    embeddingModel?: string;
  } = {}) {
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
    this.model = config.model ?? 'llama3.2';
    this.embeddingModel = config.embeddingModel ?? 'nomic-embed-text';
  }

  async extract(
    content: string,
    context?: ExtractionContext,
  ): Promise<ExtractionResult> {
    const prompt = buildExtractionPrompt(content, context);
    const raw = await this.generateText(prompt);
    try {
      return parseJsonOutput(raw, ExtractionOutputSchema);
    } catch {
      return emptyExtractionResult();
    }
  }

  async answer(query: string, context: AnswerContext): Promise<AnswerResult> {
    const itemSummaries = context.relevantItems.map(
      (item) =>
        `[${item.id}] ${item.subject ?? '(no subject)'}: ${item.body.slice(0, 300)}`,
    );
    const entitySummaries = context.relevantEntities.map(
      (e) => `${e.canonicalName} (${e.type})`,
    );

    const prompt = buildAnswerPrompt(query, itemSummaries, entitySummaries);
    const raw = await this.generateText(prompt);

    try {
      const output = parseJsonOutput(raw, AnswerOutputSchema);
      const sourceItemIds = output.sourceIndices
        .map((i) => context.relevantItems[i - 1]?.id)
        .filter((id): id is string => id !== undefined);
      return { answer: output.answer, sourceItemIds, confidence: output.confidence };
    } catch {
      return { answer: raw.slice(0, 500), sourceItemIds: [], confidence: 0.3 };
    }
  }

  async embed(text: string): Promise<Float64Array> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.embeddingModel, prompt: text }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${response.status}`);
    }

    const data = (await response.json()) as { embedding: number[] };
    return new Float64Array(data.embedding);
  }

  async embedBatch(texts: string[]): Promise<Float64Array[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async generateText(prompt: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama generate failed: ${response.status}`);
    }

    const data = (await response.json()) as { response: string };
    return data.response;
  }
}

// ---------------------------------------------------------------------------
// MockProvider (for testing)
// ---------------------------------------------------------------------------

export class MockProvider implements LLMProvider {
  readonly name = 'mock';

  private readonly fixedResult: ExtractionResult | null;

  constructor(fixedResult?: ExtractionResult) {
    this.fixedResult = fixedResult ?? null;
  }

  async extract(
    _content: string,
    _context?: ExtractionContext,
  ): Promise<ExtractionResult> {
    return (
      this.fixedResult ?? {
        entities: [
          {
            type: EntityType.Topic,
            name: 'Test Topic',
            nameAlt: null,
            attributes: {},
            confidence: 0.9,
          },
        ],
        relationships: [],
        summary: 'Mock extraction result.',
        language: DetectedLanguage.English,
      }
    );
  }

  async answer(_query: string, _context: AnswerContext): Promise<AnswerResult> {
    return {
      answer: 'This is a mock answer.',
      sourceItemIds: [],
      confidence: 1.0,
    };
  }

  async embed(text: string): Promise<Float64Array> {
    // Deterministic mock: hash the text into a fixed-size vector
    const arr = new Float64Array(16);
    for (let i = 0; i < text.length && i < 16; i++) {
      arr[i] = text.charCodeAt(i) / 127;
    }
    return arr;
  }

  async embedBatch(texts: string[]): Promise<Float64Array[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyExtractionResult(): ExtractionResult {
  return {
    entities: [],
    relationships: [],
    summary: null,
    language: DetectedLanguage.English,
  };
}
