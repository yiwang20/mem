import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenClawProvider, detectOpenClawCredentials, readOpenClawAnthropicToken } from '../../src/llm/openclaw-provider.js';

// ---------------------------------------------------------------------------
// Mock fs.readFileSync
// ---------------------------------------------------------------------------

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

import { readFileSync } from 'node:fs';
const mockReadFileSync = vi.mocked(readFileSync);

function setProfilesFile(profiles: Record<string, unknown>): void {
  mockReadFileSync.mockReturnValue(
    JSON.stringify({ version: 1, profiles }) as unknown as Buffer,
  );
}

function setFileNotFound(): void {
  mockReadFileSync.mockImplementation(() => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
}

// ---------------------------------------------------------------------------
// readOpenClawAnthropicToken
// ---------------------------------------------------------------------------

describe('readOpenClawAnthropicToken', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns token for anthropic: key with type token', () => {
    setProfilesFile({
      'anthropic:default': { type: 'token', provider: 'anthropic', token: 'sk-ant-test123' },
    });
    expect(readOpenClawAnthropicToken('/fake/path')).toBe('sk-ant-test123');
  });

  it('returns null when no anthropic: key exists', () => {
    setProfilesFile({
      'google:default': { type: 'api_key', provider: 'google', key: 'some-key' },
    });
    expect(readOpenClawAnthropicToken('/fake/path')).toBeNull();
  });

  it('returns null when anthropic profile has wrong type', () => {
    setProfilesFile({
      'anthropic:default': { type: 'oauth', provider: 'anthropic', access: 'tok' },
    });
    expect(readOpenClawAnthropicToken('/fake/path')).toBeNull();
  });

  it('returns null when file does not exist', () => {
    setFileNotFound();
    expect(readOpenClawAnthropicToken('/fake/path')).toBeNull();
  });

  it('returns null when file contains invalid JSON', () => {
    mockReadFileSync.mockReturnValue('not json' as unknown as Buffer);
    expect(readOpenClawAnthropicToken('/fake/path')).toBeNull();
  });

  it('returns null when profiles is missing from file', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: 1 }) as unknown as Buffer);
    expect(readOpenClawAnthropicToken('/fake/path')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// OpenClawProvider — isAvailable
// ---------------------------------------------------------------------------

describe('OpenClawProvider.isAvailable', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when Anthropic token is found', async () => {
    setProfilesFile({
      'anthropic:default': { type: 'token', token: 'sk-ant-valid' },
    });
    const provider = new OpenClawProvider({ profilesPath: '/fake/path' });
    expect(await provider.isAvailable()).toBe(true);
  });

  it('returns false when no token found', async () => {
    setFileNotFound();
    const provider = new OpenClawProvider({ profilesPath: '/fake/path' });
    expect(await provider.isAvailable()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OpenClawProvider — extract fallback when no token
// ---------------------------------------------------------------------------

describe('OpenClawProvider.extract (no token)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty ExtractionResult when no token found', async () => {
    setFileNotFound();
    const provider = new OpenClawProvider({ profilesPath: '/fake/path' });
    const result = await provider.extract('some content');
    expect(result.entities).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.summary).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// OpenClawProvider — answer fallback when no token
// ---------------------------------------------------------------------------

describe('OpenClawProvider.answer (no token)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns fallback answer when no token found', async () => {
    setFileNotFound();
    const provider = new OpenClawProvider({ profilesPath: '/fake/path' });
    const result = await provider.answer('query', { relevantItems: [], relevantEntities: [] });
    expect(result.answer).toBe('OpenClaw credentials not available.');
    expect(result.confidence).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// OpenClawProvider — embed fallback
// ---------------------------------------------------------------------------

describe('OpenClawProvider.embed (no token)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns zero Float64Array when no token', async () => {
    setFileNotFound();
    const provider = new OpenClawProvider({ profilesPath: '/fake/path' });
    const vec = await provider.embed('hello');
    expect(vec).toBeInstanceOf(Float64Array);
    expect(vec.length).toBe(1536);
  });

  it('embedBatch returns one vector per text when no token', async () => {
    setFileNotFound();
    const provider = new OpenClawProvider({ profilesPath: '/fake/path' });
    const results = await provider.embedBatch(['a', 'b', 'c']);
    expect(results).toHaveLength(3);
    results.forEach((v) => expect(v).toBeInstanceOf(Float64Array));
  });
});

// ---------------------------------------------------------------------------
// OpenClawProvider — delegates to ClaudeProvider when token present
// ---------------------------------------------------------------------------

describe('OpenClawProvider with token', () => {
  beforeEach(() => {
    setProfilesFile({
      'anthropic:default': { type: 'token', token: 'sk-ant-fake-token' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has name "openclaw"', () => {
    const provider = new OpenClawProvider({ profilesPath: '/fake/path' });
    expect(provider.name).toBe('openclaw');
  });

  it('isAvailable returns true without network call', async () => {
    const provider = new OpenClawProvider({ profilesPath: '/fake/path' });
    expect(await provider.isAvailable()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectOpenClawCredentials
// ---------------------------------------------------------------------------

describe('detectOpenClawCredentials', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns OpenClawProvider when token found', () => {
    setProfilesFile({
      'anthropic:default': { type: 'token', token: 'sk-ant-abc' },
    });
    const result = detectOpenClawCredentials({ profilesPath: '/fake/path' });
    expect(result).toBeInstanceOf(OpenClawProvider);
    expect(result?.name).toBe('openclaw');
  });

  it('returns null when no Anthropic token in profiles', () => {
    setProfilesFile({
      'openai:default': { type: 'api_key', key: 'sk-openai-abc' },
    });
    const result = detectOpenClawCredentials({ profilesPath: '/fake/path' });
    expect(result).toBeNull();
  });

  it('returns null when file not found', () => {
    setFileNotFound();
    const result = detectOpenClawCredentials({ profilesPath: '/fake/path' });
    expect(result).toBeNull();
  });
});
