/**
 * Local embedding provider using @xenova/transformers.
 * Runs the all-MiniLM-L6-v2 model locally (22MB, 384 dimensions).
 * Model is downloaded on first use and cached locally.
 */
export class LocalEmbeddingProvider {
  private pipeline: unknown = null;
  private initialized = false;

  constructor(readonly modelName = 'Xenova/all-MiniLM-L6-v2') {}

  async init(): Promise<void> {
    if (this.initialized) return;
    const { pipeline } = await import('@xenova/transformers');
    this.pipeline = await pipeline('feature-extraction', this.modelName);
    this.initialized = true;
    console.log(`[LocalEmbedding] Model ${this.modelName} loaded`);
  }

  async embed(text: string): Promise<Float64Array> {
    await this.init();
    const result = await (this.pipeline as (text: string, opts: Record<string, unknown>) => Promise<{ data: ArrayLike<number> }>)(
      text,
      { pooling: 'mean', normalize: true },
    );
    return new Float64Array(result.data);
  }

  async embedBatch(texts: string[], batchSize = 8): Promise<Float64Array[]> {
    await this.init();
    const results: Float64Array[] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      for (const text of batch) {
        results.push(await this.embed(text));
      }
    }
    return results;
  }

  get dimensions(): number {
    return 384;
  }
}
