import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, MindFlowConfigSchema } from '../../src/core/config.js';
import { PrivacyMode } from '../../src/types/index.js';

describe('MindFlowConfigSchema', () => {
  it('parses an empty object into full defaults', () => {
    const config = MindFlowConfigSchema.parse({});
    expect(config.ingestionIntervalMs).toBe(900_000);
    expect(config.ingestionBatchSize).toBe(100);
    expect(config.privacyMode).toBe(PrivacyMode.ContentAware);
    expect(config.llm.extractionProvider).toBe('claude');
    expect(config.initialScanDepth).toBe('month');
  });

  it('overrides individual fields', () => {
    const config = MindFlowConfigSchema.parse({
      ingestionBatchSize: 50,
      privacyMode: PrivacyMode.FullLocal,
    });
    expect(config.ingestionBatchSize).toBe(50);
    expect(config.privacyMode).toBe(PrivacyMode.FullLocal);
    // Unset fields keep defaults
    expect(config.ingestionIntervalMs).toBe(900_000);
  });

  it('rejects ingestionIntervalMs below minimum', () => {
    expect(() =>
      MindFlowConfigSchema.parse({ ingestionIntervalMs: 1000 }),
    ).toThrow();
  });

  it('rejects invalid initialScanDepth', () => {
    expect(() =>
      MindFlowConfigSchema.parse({ initialScanDepth: 'decade' }),
    ).toThrow();
  });

  it('rejects negative monthlyBudgetCap', () => {
    expect(() =>
      MindFlowConfigSchema.parse({ llm: { monthlyBudgetCap: -5 } }),
    ).toThrow();
  });
});

describe('DEFAULT_CONFIG', () => {
  it('is a fully resolved config object', () => {
    expect(DEFAULT_CONFIG).toHaveProperty('dbPath');
    expect(DEFAULT_CONFIG).toHaveProperty('dataDir');
    expect(DEFAULT_CONFIG.llm).toBeDefined();
    expect(DEFAULT_CONFIG.sources).toBeDefined();
    expect(DEFAULT_CONFIG.exclusions).toBeDefined();
  });
});
