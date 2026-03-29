import type Database from 'better-sqlite3';
import type {
  Entity,
  EntityAlias,
  ExtractedEntity,
  LLMProvider,
  RawItem,
} from '../types/index.js';
import { AliasType, EntityStatus, EntityType } from '../types/index.js';
import type { EntityRepository } from '../storage/repositories.js';
import type { EntityAliasRepository } from '../storage/repositories.js';
import { normalizeEmail, normalizePhone, nameSimilarity } from './name-utils.js';

// ----------------------------------------------------------------------------
// Resolution result types
// ----------------------------------------------------------------------------

export type ResolutionDecision =
  | { kind: 'matched'; entityId: string; confidence: number }
  | { kind: 'suggest'; entityId: string; confidence: number }
  | { kind: 'new' }
  | { kind: 'pending_user'; entityId: string; confidence: number };

export interface ResolvedEntity {
  extractedEntity: ExtractedEntity;
  decision: ResolutionDecision;
}

// ----------------------------------------------------------------------------
// Thresholds
// ----------------------------------------------------------------------------

const AUTO_MERGE_THRESHOLD = 0.9;
const SUGGEST_THRESHOLD = 0.7;

// Co-occurrence boost: added to the name-similarity score when two entities
// appear in the same thread / raw item.
const CO_OCCURRENCE_BOOST = 0.05;

// ----------------------------------------------------------------------------
// EntityResolver
// ----------------------------------------------------------------------------

export class EntityResolver {
  constructor(
    private readonly db: Database.Database,
    private readonly entityRepo: EntityRepository,
    private readonly aliasRepo: EntityAliasRepository,
    private readonly llmProvider: LLMProvider | null = null,
  ) {}

  /**
   * Run the 4-stage resolution pipeline for a batch of extracted entities
   * from a single raw item.
   *
   * Returns a ResolvedEntity for each input, indicating whether it matched an
   * existing entity, should be suggested for merge, needs user confirmation, or
   * is brand new.
   */
  async resolve(
    extractedEntities: ExtractedEntity[],
    rawItem: RawItem,
  ): Promise<ResolvedEntity[]> {
    const results: ResolvedEntity[] = [];
    const ambiguous: Array<{ idx: number; entityId: string; score: number }> = [];

    for (let i = 0; i < extractedEntities.length; i++) {
      const extracted = extractedEntities[i]!;

      // Stage 1 – deterministic
      const stage1 = this.runStage1(extracted);
      if (stage1) {
        results.push({ extractedEntity: extracted, decision: stage1 });
        continue;
      }

      // Stage 2 – probabilistic
      const stage2 = this.runStage2(extracted, rawItem);
      if (stage2 !== null) {
        if (stage2.confidence >= AUTO_MERGE_THRESHOLD) {
          results.push({
            extractedEntity: extracted,
            decision: { kind: 'matched', entityId: stage2.entityId, confidence: stage2.confidence },
          });
        } else if (stage2.confidence >= SUGGEST_THRESHOLD) {
          // Queue for Stage 3 (LLM) resolution
          ambiguous.push({ idx: i, entityId: stage2.entityId, score: stage2.confidence });
          results.push({ extractedEntity: extracted, decision: { kind: 'new' } }); // placeholder
        } else {
          results.push({ extractedEntity: extracted, decision: { kind: 'new' } });
        }
        continue;
      }

      results.push({ extractedEntity: extracted, decision: { kind: 'new' } });
    }

    // Stage 3 – LLM-assisted batch resolution
    if (ambiguous.length > 0 && this.llmProvider !== null) {
      const llmResults = await this.runStage3(ambiguous, extractedEntities, rawItem);
      for (const lr of llmResults) {
        results[lr.idx] = {
          extractedEntity: extractedEntities[lr.idx]!,
          decision: lr.decision,
        };
      }
    } else if (ambiguous.length > 0) {
      // No LLM available — fall through to Stage 4 (user confirmation)
      for (const a of ambiguous) {
        results[a.idx] = {
          extractedEntity: extractedEntities[a.idx]!,
          decision: { kind: 'pending_user', entityId: a.entityId, confidence: a.score },
        };
      }
    }

    return results;
  }

  // --------------------------------------------------------------------------
  // Stage 1 — Deterministic matching
  // --------------------------------------------------------------------------

  private runStage1(extracted: ExtractedEntity): ResolutionDecision | null {
    const attrs = extracted.attributes as Record<string, unknown>;

    // Email exact match
    const rawEmail = attrs['email'] as string | null | undefined;
    if (rawEmail) {
      const email = normalizeEmail(rawEmail);
      const matches = this.findEntitiesByAlias(email, AliasType.Email);
      if (matches.length > 0) {
        return { kind: 'matched', entityId: matches[0]!.entityId, confidence: 1.0 };
      }
    }

    // Phone exact match
    const rawPhone = attrs['phone'] as string | null | undefined;
    if (rawPhone) {
      const phone = normalizePhone(rawPhone);
      const matches = this.findEntitiesByAlias(phone, AliasType.Phone);
      if (matches.length > 0) {
        return { kind: 'matched', entityId: matches[0]!.entityId, confidence: 1.0 };
      }
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Stage 2 — Probabilistic matching
  // --------------------------------------------------------------------------

  private runStage2(
    extracted: ExtractedEntity,
    rawItem: RawItem,
  ): { entityId: string; confidence: number } | null {
    // Only attempt name-based matching for entities that have a meaningful name
    if (!extracted.name || extracted.name.trim().length === 0) return null;

    const candidates = this.entityRepo.findByType(extracted.type);
    let bestScore = 0;
    let bestId: string | null = null;

    for (const candidate of candidates) {
      if (candidate.status === EntityStatus.Merged) continue;

      let score = nameSimilarity(extracted.name, candidate.canonicalName);

      // Check alt name too
      if (candidate.nameAlt) {
        score = Math.max(score, nameSimilarity(extracted.name, candidate.nameAlt));
      }

      // Check aliases
      const aliases = this.aliasRepo.findByEntity(candidate.id);
      for (const a of aliases) {
        if (a.aliasType === AliasType.Name) {
          score = Math.max(score, nameSimilarity(extracted.name, a.alias));
        }
      }

      // Co-occurrence boost: boost if the candidate already appears in the same thread
      if (rawItem.threadId && this.entityAppearsInThread(candidate.id, rawItem.threadId)) {
        score = Math.min(1.0, score + CO_OCCURRENCE_BOOST);
      }

      if (score > bestScore) {
        bestScore = score;
        bestId = candidate.id;
      }
    }

    if (bestId !== null && bestScore >= SUGGEST_THRESHOLD) {
      return { entityId: bestId, confidence: bestScore };
    }
    return null;
  }

  // --------------------------------------------------------------------------
  // Stage 3 — LLM-assisted resolution
  // --------------------------------------------------------------------------

  private async runStage3(
    ambiguous: Array<{ idx: number; entityId: string; score: number }>,
    allExtracted: ExtractedEntity[],
    rawItem: RawItem,
  ): Promise<Array<{ idx: number; decision: ResolutionDecision }>> {
    if (!this.llmProvider) return [];

    // Build a prompt listing the ambiguous pairs and ask the LLM to decide
    const pairs = ambiguous.map((a) => {
      const extracted = allExtracted[a.idx]!;
      const existing = this.entityRepo.findById(a.entityId);
      return `Extracted: "${extracted.name}" | Existing: "${existing?.canonicalName ?? '?'}" (similarity: ${a.score.toFixed(2)})`;
    });

    const prompt = [
      'You are resolving entity identity. For each pair below, decide if they refer to the same real-world entity.',
      'Reply with a JSON array of objects: [{"idx": <number>, "same": <true|false>}]',
      'Context: ' + rawItem.subject,
      '',
      ...pairs.map((p, i) => `${i}: ${p}`),
    ].join('\n');

    let llmDecisions: Array<{ idx: number; same: boolean }> = [];

    try {
      const result = await this.llmProvider.answer(prompt, {
        relevantItems: [rawItem],
        relevantEntities: [],
        relevantRelationships: [],
      });

      // Parse JSON from the answer text
      const jsonMatch = result.answer.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        llmDecisions = JSON.parse(jsonMatch[0]) as Array<{ idx: number; same: boolean }>;
      }
    } catch {
      // LLM failure — fall back to Stage 4
    }

    return ambiguous.map((a, i) => {
      const llmSays = llmDecisions.find((d) => d.idx === i);
      if (llmSays?.same === true) {
        return {
          idx: a.idx,
          decision: { kind: 'matched', entityId: a.entityId, confidence: a.score } as ResolutionDecision,
        };
      }
      // LLM said different, or no answer — queue for user confirmation
      return {
        idx: a.idx,
        decision: { kind: 'pending_user', entityId: a.entityId, confidence: a.score } as ResolutionDecision,
      };
    });
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private findEntitiesByAlias(
    alias: string,
    type: AliasType,
  ): EntityAlias[] {
    return (
      this.db
        .prepare(
          `SELECT ea.*
           FROM entity_aliases ea
           JOIN entities e ON e.id = ea.entity_id
           WHERE ea.alias = ? AND ea.alias_type = ? AND e.status != 'merged'`,
        )
        .all(alias, type) as Array<Record<string, unknown>>
    ).map((row) => ({
      id: row['id'] as string,
      entityId: row['entity_id'] as string,
      alias: row['alias'] as string,
      aliasType: row['alias_type'] as AliasType,
      confidence: row['confidence'] as number,
    }));
  }

  private entityAppearsInThread(entityId: string, threadId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1
         FROM raw_items ri
         JOIN entity_episodes ee ON ee.raw_item_id = ri.id
         WHERE ri.thread_id = ? AND ee.entity_id = ?
         LIMIT 1`,
      )
      .get(threadId, entityId);
    return row !== undefined;
  }
}
