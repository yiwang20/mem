// ============================================================================
// DataExporter — JSON-LD export and right-to-delete
// ============================================================================

import { writeFile } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import { EntityType } from '../types/index.js';

// ---------------------------------------------------------------------------
// JSON-LD schema.org type mapping
// ---------------------------------------------------------------------------

const ENTITY_TYPE_TO_SCHEMA: Record<string, string> = {
  [EntityType.Person]: 'schema:Person',
  [EntityType.Topic]: 'schema:Thing',
  [EntityType.ActionItem]: 'schema:Action',
  [EntityType.KeyFact]: 'schema:Statement',
  [EntityType.Document]: 'schema:DigitalDocument',
  [EntityType.Thread]: 'schema:ConversationThread',
};

const RELATIONSHIP_TYPE_TO_PREDICATE: Record<string, string> = {
  discusses: 'schema:about',
  communicates_with: 'schema:knows',
  assigned_to: 'schema:performer',
  requested_by: 'schema:agent',
  related_to: 'schema:isRelatedTo',
  part_of: 'schema:isPartOf',
  participates_in: 'schema:participant',
  continues_in: 'mf:continuesIn',
  member_of: 'schema:memberOf',
};

// ---------------------------------------------------------------------------
// DataExporter
// ---------------------------------------------------------------------------

export class DataExporter {
  constructor(private readonly db: Database.Database) {}

  /**
   * Export the full knowledge graph as a JSON-LD document and write it to
   * `outputPath`. Returns the document for callers that need it in-memory
   * (e.g., the HTTP route).
   */
  async exportJsonLd(outputPath?: string): Promise<Record<string, unknown>> {
    const doc = this.buildJsonLdDocument();
    if (outputPath) {
      await writeFile(outputPath, JSON.stringify(doc, null, 2), 'utf8');
    }
    return doc;
  }

  /**
   * Right-to-delete: removes an entity and all associated data:
   * - entity_aliases
   * - entity_episodes
   * - relationships (both directions)
   * - attention_items referencing the entity
   * - merge_audit records
   * - the entity row itself
   *
   * Wrapped in a transaction for atomicity.
   */
  deleteEntity(entityId: string): void {
    const doDelete = this.db.transaction(() => {
      this.db.prepare('DELETE FROM entity_aliases WHERE entity_id = ?').run(entityId);
      this.db.prepare('DELETE FROM entity_episodes WHERE entity_id = ?').run(entityId);
      this.db
        .prepare(
          'DELETE FROM relationships WHERE from_entity_id = ? OR to_entity_id = ?',
        )
        .run(entityId, entityId);
      this.db
        .prepare('DELETE FROM attention_items WHERE entity_id = ?')
        .run(entityId);
      this.db
        .prepare(
          'DELETE FROM merge_audit WHERE surviving_entity_id = ? OR merged_entity_id = ?',
        )
        .run(entityId, entityId);
      this.db.prepare('DELETE FROM entities WHERE id = ?').run(entityId);
    });

    doDelete();
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private buildJsonLdDocument(): Record<string, unknown> {
    const entities = this.db
      .prepare(`SELECT * FROM entities WHERE status != 'merged'`)
      .all() as Array<Record<string, unknown>>;

    const relationships = this.db
      .prepare('SELECT * FROM relationships WHERE valid_until IS NULL')
      .all() as Array<Record<string, unknown>>;

    const rawItems = this.db
      .prepare('SELECT id, source_adapter, channel, external_id, subject, event_time, body_format FROM raw_items')
      .all() as Array<Record<string, unknown>>;

    const graph: unknown[] = [];

    // Entities → JSON-LD nodes
    for (const e of entities) {
      const type = e['type'] as string;
      const schemaType = ENTITY_TYPE_TO_SCHEMA[type] ?? 'schema:Thing';

      let aliases: string[] = [];
      try {
        aliases = JSON.parse(e['aliases'] as string ?? '[]') as string[];
      } catch { /* ignore */ }

      let attributes: Record<string, unknown> = {};
      try {
        attributes = JSON.parse(e['attributes'] as string ?? '{}') as Record<string, unknown>;
      } catch { /* ignore */ }

      graph.push({
        '@id': `mf:entity/${e['id']}`,
        '@type': schemaType,
        'schema:name': e['canonical_name'],
        ...(e['name_alt'] ? { 'schema:alternateName': e['name_alt'] } : {}),
        ...(aliases.length > 0 ? { 'mf:aliases': aliases } : {}),
        'schema:dateCreated': new Date(e['created_at'] as number).toISOString(),
        'schema:dateModified': new Date(e['updated_at'] as number).toISOString(),
        'mf:status': e['status'],
        'mf:confidence': e['confidence'],
        ...flattenAttributes(attributes),
      });
    }

    // Relationships → JSON-LD edges
    for (const r of relationships) {
      const relType = r['type'] as string;
      const predicate = RELATIONSHIP_TYPE_TO_PREDICATE[relType] ?? `mf:${relType}`;

      graph.push({
        '@id': `mf:relationship/${r['id']}`,
        '@type': 'mf:Relationship',
        [predicate]: { '@id': `mf:entity/${r['to_entity_id']}` },
        'mf:from': { '@id': `mf:entity/${r['from_entity_id']}` },
        'mf:strength': r['strength'],
        'mf:occurrenceCount': r['occurrence_count'],
        ...(r['event_time']
          ? { 'schema:startDate': new Date(r['event_time'] as number).toISOString() }
          : {}),
      });
    }

    // Raw items → source references
    for (const item of rawItems) {
      graph.push({
        '@id': `mf:item/${item['id']}`,
        '@type': 'mf:SourceItem',
        'mf:sourceAdapter': item['source_adapter'],
        'mf:channel': item['channel'],
        'mf:externalId': item['external_id'],
        ...(item['subject'] ? { 'schema:name': item['subject'] } : {}),
        'schema:datePublished': new Date(item['event_time'] as number).toISOString(),
        'mf:bodyFormat': item['body_format'],
      });
    }

    return {
      '@context': {
        '@vocab': 'https://schema.org/',
        'schema': 'https://schema.org/',
        'mf': 'https://mindflow.local/vocab#',
        'xsd': 'http://www.w3.org/2001/XMLSchema#',
      },
      '@graph': graph,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Flatten entity attributes into schema.org / mf: predicates.
 * Only include primitive values to keep the document clean.
 */
function flattenAttributes(
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[`mf:attr_${key}`] = value;
    }
  }
  return result;
}
