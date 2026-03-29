import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  AnswerContext,
  AnswerResult,
  ExtractionContext,
  ExtractionResult,
  LLMProvider,
} from '../types/index.js';
import { DetectedLanguage } from '../types/index.js';
import { ClaudeProvider } from './provider.js';

// ---------------------------------------------------------------------------
// Auth-profiles parsing
// ---------------------------------------------------------------------------

const DEFAULT_AUTH_PROFILES_PATH = join(
  homedir(),
  '.openclaw/agents/main/agent/auth-profiles.json',
);

interface AuthProfile {
  type: string;
  provider?: string;
  token?: string;
}

interface AuthProfilesFile {
  version?: number;
  profiles?: Record<string, AuthProfile>;
}

/**
 * Read OpenClaw's auth-profiles.json and extract the first Anthropic token
 * profile (key starts with "anthropic:", type === "token").
 * Returns the token string, or null if not found or file unreadable.
 */
export function readOpenClawAnthropicToken(
  profilesPath = DEFAULT_AUTH_PROFILES_PATH,
): string | null {
  try {
    const raw = readFileSync(profilesPath, 'utf-8');
    const data = JSON.parse(raw) as AuthProfilesFile;
    const profiles = data.profiles ?? {};
    for (const [key, profile] of Object.entries(profiles)) {
      if (key.startsWith('anthropic:') && profile.type === 'token' && profile.token) {
        return profile.token;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// OpenClawProvider
// ---------------------------------------------------------------------------

export interface OpenClawConfig {
  /** Path to auth-profiles.json. Defaults to ~/.openclaw/agents/main/agent/auth-profiles.json */
  profilesPath?: string;
  /** Optional model override passed to ClaudeProvider */
  model?: string;
}

/**
 * OpenClawProvider reads the Anthropic API token from OpenClaw's local
 * auth-profiles.json and delegates all LLM calls to ClaudeProvider using
 * that token. If no token is found, isAvailable() returns false and all
 * methods return safe empty/fallback results.
 */
export class OpenClawProvider implements LLMProvider {
  readonly name = 'openclaw';

  private readonly delegate: ClaudeProvider | null;

  constructor(config: OpenClawConfig = {}) {
    const token = readOpenClawAnthropicToken(config.profilesPath);
    if (token) {
      this.delegate = new ClaudeProvider({
        apiKey: token,
        ...(config.model ? { model: config.model } : {}),
      });
    } else {
      this.delegate = null;
    }
  }

  async extract(
    content: string,
    context?: ExtractionContext,
  ): Promise<ExtractionResult> {
    if (!this.delegate) return emptyExtractionResult();
    return this.delegate.extract(content, context);
  }

  async answer(query: string, context: AnswerContext): Promise<AnswerResult> {
    if (!this.delegate) {
      return { answer: 'OpenClaw credentials not available.', sourceItemIds: [], confidence: 0 };
    }
    return this.delegate.answer(query, context);
  }

  async embed(text: string): Promise<Float64Array> {
    if (!this.delegate) return new Float64Array(1536);
    return this.delegate.embed(text);
  }

  async embedBatch(texts: string[]): Promise<Float64Array[]> {
    if (!this.delegate) return texts.map(() => new Float64Array(1536));
    return this.delegate.embedBatch(texts);
  }

  async isAvailable(): Promise<boolean> {
    return this.delegate !== null;
  }
}

// ---------------------------------------------------------------------------
// Auto-detect helper
// ---------------------------------------------------------------------------

/**
 * Try to read the OpenClaw auth-profiles.json and extract an Anthropic token.
 * Returns an OpenClawProvider if a token is found, otherwise null.
 */
export function detectOpenClawCredentials(
  config: OpenClawConfig = {},
): OpenClawProvider | null {
  const token = readOpenClawAnthropicToken(config.profilesPath);
  if (!token) return null;
  return new OpenClawProvider(config);
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
