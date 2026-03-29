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
// OpenAI-compatible response shapes
// ---------------------------------------------------------------------------

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
}

interface EmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJsonOutput<S extends z.ZodTypeAny>(raw: string, schema: S): z.output<S> {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const parsed: unknown = JSON.parse(cleaned);
  return schema.parse(parsed) as z.output<S>;
}

function emptyExtractionResult(): ExtractionResult {
  return {
    entities: [],
    relationships: [],
    summary: null,
    language: DetectedLanguage.English,
  };
}

// ---------------------------------------------------------------------------
// AzureProvider
// ---------------------------------------------------------------------------

export interface AzureConfig {
  /** Azure OpenAI resource endpoint, e.g. https://{resource}.openai.azure.com */
  endpoint: string;
  /** Deployment name for chat completions */
  deploymentName: string;
  /** Azure OpenAI API key */
  apiKey: string;
  /** API version (default: "2024-12-01-preview") */
  apiVersion?: string;
  /** Optional deployment name for embeddings; if omitted, embed returns zero vectors */
  embeddingDeployment?: string;
}

export class AzureProvider implements LLMProvider {
  readonly name = 'azure';

  private readonly endpoint: string;
  private readonly deploymentName: string;
  private readonly apiKey: string;
  private readonly apiVersion: string;
  private readonly embeddingDeployment: string | null;

  constructor(config: AzureConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.deploymentName = config.deploymentName;
    this.apiKey = config.apiKey;
    this.apiVersion = config.apiVersion ?? '2024-12-01-preview';
    this.embeddingDeployment = config.embeddingDeployment ?? null;
  }

  async extract(
    content: string,
    context?: ExtractionContext,
  ): Promise<ExtractionResult> {
    const prompt = buildExtractionPrompt(content, context);
    try {
      const raw = await this.chatCompletion(
        'You are an information extraction assistant. Return valid JSON only.',
        prompt,
        { maxTokens: 4096, jsonMode: true },
      );
      return parseJsonOutput(raw, ExtractionOutputSchema);
    } catch {
      return emptyExtractionResult();
    }
  }

  async answer(query: string, context: AnswerContext): Promise<AnswerResult> {
    const items = context.relevantItems ?? [];
    const entities = context.relevantEntities ?? [];
    const itemSummaries = items.map(
      (item) =>
        `[${item.id}] ${item.subject ?? '(no subject)'}: ${item.body.slice(0, 300)}`,
    );
    const entitySummaries = entities.map(
      (e) => `${e.canonicalName} (${e.type})`,
    );

    const prompt = buildAnswerPrompt(query, itemSummaries, entitySummaries);
    try {
      const raw = await this.chatCompletion(
        'You are a personal knowledge assistant. Return valid JSON only.',
        prompt,
        { maxTokens: 1024, jsonMode: true },
      );
      const output = parseJsonOutput(raw, AnswerOutputSchema);
      const sourceItemIds = output.sourceIndices
        .map((i) => items[i - 1]?.id)
        .filter((id): id is string => id !== undefined);
      return { answer: output.answer, sourceItemIds, confidence: output.confidence };
    } catch {
      return { answer: 'Unable to generate an answer.', sourceItemIds: [], confidence: 0 };
    }
  }

  async embed(text: string): Promise<Float64Array> {
    if (!this.embeddingDeployment) return new Float64Array(1536);
    const url = `${this.endpoint}/openai/deployments/${this.embeddingDeployment}/embeddings?api-version=${this.apiVersion}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ input: text }),
    });
    if (!response.ok) {
      throw new Error(`Azure embedding failed: ${response.status}`);
    }
    const data = (await response.json()) as EmbeddingResponse;
    return new Float64Array(data.data[0]?.embedding ?? []);
  }

  async embedBatch(texts: string[]): Promise<Float64Array[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  async isAvailable(): Promise<boolean> {
    // A provider is available if it has the minimum required config
    return Boolean(this.endpoint && this.deploymentName && this.apiKey);
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  chatCompletionUrl(): string {
    return `${this.endpoint}/openai/deployments/${this.deploymentName}/chat/completions?api-version=${this.apiVersion}`;
  }

  private headers(): Record<string, string> {
    return {
      'api-key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  private async chatCompletion(
    systemPrompt: string,
    userContent: string,
    options: { maxTokens?: number; jsonMode?: boolean } = {},
  ): Promise<string> {
    const body: Record<string, unknown> = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      max_completion_tokens: options.maxTokens ?? 1024,
    };

    if (options.jsonMode) {
      body['response_format'] = { type: 'json_object' };
    }

    const response = await fetch(this.chatCompletionUrl(), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Azure OpenAI error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices[0]?.message.content;
    if (!content) {
      throw new Error('Azure OpenAI returned empty content');
    }
    return content;
  }
}
