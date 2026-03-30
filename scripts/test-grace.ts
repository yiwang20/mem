import { MindFlowEngine } from '../src/core/engine.js';
import { createHash } from 'node:crypto';
import { ulid } from '../src/utils/ulid.js';
import { BodyFormat, ProcessingStatus, SourceAdapterType, JobStage } from '../src/types/index.js';

async function main() {
  const engine = new MindFlowEngine();
  await engine.init();

  const body = 'Hi team, the Q3 engineering budget has been approved. We have $150K for infrastructure upgrades and $80K for tooling.';
  const contentHash = createHash('sha256').update(body).digest('hex');
  const now = Date.now();
  const item: any = {
    id: ulid(), sourceAdapter: SourceAdapterType.Filesystem, channel: 'email',
    externalId: ulid(), threadId: null, senderEntityId: null, recipientEntityIds: [],
    subject: 'Q3 Budget Approval', body, bodyFormat: BodyFormat.Plaintext, contentHash,
    language: null, eventTime: now, ingestedAt: now, processingStatus: ProcessingStatus.Pending,
    attachments: [], metadata: { sender: 'Grace Huang', recipients: [], mockData: true },
  };
  engine.rawItems.insert(item);
  engine.jobs.enqueue({ id: ulid(), rawItemId: item.id, stage: JobStage.Triage, status: 'pending' as any, attempts: 0, maxAttempts: 3, createdAt: now, updatedAt: now, error: null });

  await engine.ingest();

  const persons = engine.db.db.prepare("SELECT canonical_name, type FROM entities WHERE type = 'person'").all();
  console.log('Persons:', persons);
  const all = engine.db.db.prepare("SELECT canonical_name, type FROM entities").all();
  console.log('All entities:', all);
}

main().catch(console.error);
