import { afterEach, describe, expect, it, vi } from 'vitest';
import { AzureProvider } from '../../src/llm/azure-provider.js';
import { EntityType } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    (url, init) => Promise.resolve(handler(String(url), init ?? undefined)),
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, text = 'error'): Response {
  return new Response(text, { status });
}

// ---------------------------------------------------------------------------
// Shared provider factory
// ---------------------------------------------------------------------------

function makeProvider(overrides: Partial<ConstructorParameters<typeof AzureProvider>[0]> = {}): AzureProvider {
  return new AzureProvider({
    endpoint: 'https://myresource.openai.azure.com',
    deploymentName: 'gpt-4o',
    apiKey: 'test-api-key',
    apiVersion: '2024-12-01-preview',
    ...overrides,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------------------

describe('URL construction', () => {
  it('builds correct chat completions URL', () => {
    const provider = makeProvider();
    expect(provider.chatCompletionUrl()).toBe(
      'https://myresource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-12-01-preview',
    );
  });

  it('strips trailing slash from endpoint', () => {
    const provider = makeProvider({ endpoint: 'https://myresource.openai.azure.com/' });
    expect(provider.chatCompletionUrl()).toBe(
      'https://myresource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-12-01-preview',
    );
  });

  it('uses default api version when not specified', () => {
    const provider = new AzureProvider({
      endpoint: 'https://res.openai.azure.com',
      deploymentName: 'gpt-4o',
      apiKey: 'key',
    });
    expect(provider.chatCompletionUrl()).toContain('api-version=2024-12-01-preview');
  });
});

// ---------------------------------------------------------------------------
// isAvailable
// ---------------------------------------------------------------------------

describe('isAvailable', () => {
  it('returns true when endpoint, deploymentName, and apiKey are set', async () => {
    expect(await makeProvider().isAvailable()).toBe(true);
  });

  it('returns false when apiKey is empty', async () => {
    const provider = makeProvider({ apiKey: '' });
    expect(await provider.isAvailable()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extract
// ---------------------------------------------------------------------------

describe('extract', () => {
  it('calls chat completions and parses ExtractionResult', async () => {
    const spy = mockFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                entities: [{ type: EntityType.Person, name: 'Alice', confidence: 0.9 }],
                relationships: [],
                summary: 'Alice was mentioned.',
                language: 'en',
              }),
            },
          },
        ],
      }),
    );

    const provider = makeProvider();
    const result = await provider.extract('Alice attended the meeting.');

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.name).toBe('Alice');
    expect(result.entities[0]!.type).toBe(EntityType.Person);
    expect(result.summary).toBe('Alice was mentioned.');

    // Verify api-key header (not Authorization)
    const callInit = spy.mock.calls[0]?.[1] as RequestInit;
    const headers = callInit.headers as Record<string, string>;
    expect(headers['api-key']).toBe('test-api-key');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('returns empty result on gateway error', async () => {
    mockFetch(() => errorResponse(500, 'internal server error'));
    const result = await makeProvider().extract('some content');
    expect(result.entities).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.summary).toBeNull();
  });

  it('returns empty result when response JSON is malformed', async () => {
    mockFetch(() => jsonResponse({ choices: [{ message: { content: 'not json' } }] }));
    const result = await makeProvider().extract('some content');
    expect(result.entities).toEqual([]);
  });

  it('returns empty result when choices array is empty', async () => {
    mockFetch(() => jsonResponse({ choices: [] }));
    const result = await makeProvider().extract('some content');
    expect(result.entities).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// answer
// ---------------------------------------------------------------------------

describe('answer', () => {
  it('parses answer response and maps sourceIndices to item IDs', async () => {
    mockFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                answer: 'The meeting is on Friday.',
                sourceIndices: [1],
                confidence: 0.9,
              }),
            },
          },
        ],
      }),
    );

    const result = await makeProvider().answer('When is the meeting?', {
      relevantItems: [
        {
          id: 'item-1',
          sourceAdapter: 'gmail' as never,
          channel: 'email' as never,
          externalId: 'ext-1',
          threadId: null,
          senderEntityId: null,
          recipientEntityIds: [],
          subject: 'Meeting',
          body: 'The meeting is on Friday.',
          bodyFormat: 'plaintext' as never,
          contentHash: 'abc',
          language: null,
          eventTime: Date.now(),
          ingestedAt: Date.now(),
          processingStatus: 'done' as never,
          attachments: [],
          metadata: {},
        },
      ],
      relevantEntities: [],
      relevantRelationships: [],
    });

    expect(result.answer).toBe('The meeting is on Friday.');
    expect(result.confidence).toBe(0.9);
    expect(result.sourceItemIds).toContain('item-1');
  });

  it('returns fallback answer on gateway error', async () => {
    mockFetch(() => errorResponse(503));
    const result = await makeProvider().answer('query', {
      relevantItems: [],
      relevantEntities: [],
      relevantRelationships: [],
    });
    expect(result.answer).toBe('Unable to generate an answer.');
    expect(result.confidence).toBe(0);
  });

  it('does not crash when relevantItems or relevantEntities are undefined', async () => {
    mockFetch(() =>
      jsonResponse({
        choices: [
          { message: { content: '{"answer":"ok","sourceIndices":[],"confidence":0.5}' } },
        ],
      }),
    );
    // Simulate a caller omitting optional arrays (e.g. partial context object)
    const result = await makeProvider().answer('query', {
      relevantItems: undefined as never,
      relevantEntities: undefined as never,
      relevantRelationships: [],
    });
    expect(result.answer).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Request format
// ---------------------------------------------------------------------------

describe('request format', () => {
  it('sends system + user messages, no temperature, max_completion_tokens, and json_object format', async () => {
    const spy = mockFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content: '{"entities":[],"relationships":[],"summary":null,"language":"en"}',
            },
          },
        ],
      }),
    );

    await makeProvider().extract('test content');

    const body = JSON.parse((spy.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;
    const messages = body['messages'] as Array<{ role: string; content: string }>;
    expect(messages[0]!.role).toBe('system');
    expect(messages[1]!.role).toBe('user');
    expect(body['temperature']).toBeUndefined();
    expect(body['max_completion_tokens']).toBe(4096);
    expect(body['max_tokens']).toBeUndefined();
    expect(body['response_format']).toEqual({ type: 'json_object' });
    // Azure format: no 'model' field in body
    expect(body['model']).toBeUndefined();
  });

  it('calls the correct URL including deployment name and api-version', async () => {
    const spy = mockFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content: '{"entities":[],"relationships":[],"summary":null,"language":"en"}',
            },
          },
        ],
      }),
    );

    await makeProvider().extract('test');

    const calledUrl = String(spy.mock.calls[0]?.[0]);
    expect(calledUrl).toContain('/openai/deployments/gpt-4o/chat/completions');
    expect(calledUrl).toContain('api-version=2024-12-01-preview');
  });
});

// ---------------------------------------------------------------------------
// embed / embedBatch
// ---------------------------------------------------------------------------

describe('embed', () => {
  it('returns zero Float64Array when no embeddingDeployment configured', async () => {
    const provider = makeProvider();
    const vec = await provider.embed('hello');
    expect(vec).toBeInstanceOf(Float64Array);
    expect(vec.length).toBe(1536);
  });

  it('calls embeddings endpoint when embeddingDeployment is set', async () => {
    const spy = mockFetch(() =>
      jsonResponse({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    );

    const provider = makeProvider({ embeddingDeployment: 'text-embedding-3-large' });
    const vec = await provider.embed('hello world');

    expect(vec).toBeInstanceOf(Float64Array);
    expect(Array.from(vec)).toEqual([0.1, 0.2, 0.3]);

    const calledUrl = String(spy.mock.calls[0]?.[0]);
    expect(calledUrl).toContain('/openai/deployments/text-embedding-3-large/embeddings');
    expect(calledUrl).toContain('api-version=2024-12-01-preview');
  });

  it('embedBatch returns one vector per text', async () => {
    const provider = makeProvider();
    const results = await provider.embedBatch(['a', 'b', 'c']);
    expect(results).toHaveLength(3);
    results.forEach((v) => {
      expect(v).toBeInstanceOf(Float64Array);
      expect(v.length).toBe(1536);
    });
  });
});
