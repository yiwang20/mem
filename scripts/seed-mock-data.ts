#!/usr/bin/env npx tsx
/**
 * Seed MindFlow with ~20 mock Slack messages across several topics and people.
 * Usage: npx tsx scripts/seed-mock-data.ts
 */

import { createHash } from 'node:crypto';
import { MindFlowEngine } from '../src/core/engine.js';
import {
  BodyFormat,
  JobStage,
  ProcessingStatus,
  SourceAdapterType,
} from '../src/types/index.js';
import type { RawItem } from '../src/types/index.js';
import { ulid } from '../src/utils/ulid.js';

const MOCK_MESSAGES: Array<{
  sender: string;
  recipients?: string[];
  subject?: string;
  body: string;
  channel: string;
  threadId?: string;
  daysAgo: number;
}> = [
  // ---- Topic cluster: Q3 OKR planning ----
  {
    sender: 'Alice Chen',
    body: "Hey team, we need to finalize Q3 OKRs by Friday. I've drafted the eng objectives -- please review the doc I shared in Confluence.",
    channel: 'slack',
    threadId: 'okr-planning',
    daysAgo: 10,
  },
  {
    sender: 'Bob Zhang',
    body: "Looked at the OKRs. I think KR2 (reduce p99 latency to <200ms) is too aggressive. We should target 300ms first and iterate.",
    channel: 'slack',
    threadId: 'okr-planning',
    daysAgo: 10,
  },
  {
    sender: 'Alice Chen',
    body: "Fair point. Updated KR2 to 300ms target. Also added a new KR4 for test coverage -- aiming for 80% across core services.",
    channel: 'slack',
    threadId: 'okr-planning',
    daysAgo: 9,
  },
  {
    sender: 'Carol Wang',
    recipients: ['Alice Chen', 'Bob Zhang'],
    body: "The OKRs look solid. One suggestion: let's add a key result around on-call incident response time since that was a pain point last quarter.",
    channel: 'slack',
    threadId: 'okr-planning',
    daysAgo: 9,
  },

  // ---- Topic cluster: Auth service migration ----
  {
    sender: 'David Li',
    body: "Starting the auth service migration from Express to Fastify today. The main blocker is session middleware compatibility -- I'll need to rewrite the session store adapter.",
    channel: 'slack',
    threadId: 'auth-migration',
    daysAgo: 7,
  },
  {
    sender: 'Alice Chen',
    body: "David, make sure to coordinate with the mobile team -- they depend on the /oauth/token endpoint. Any breaking changes need a 2-week deprecation window.",
    channel: 'slack',
    threadId: 'auth-migration',
    daysAgo: 7,
  },
  {
    sender: 'David Li',
    body: "Good call. I'll keep the old endpoints alive behind a proxy layer. The new Fastify routes will live at /v2/oauth/* for now.",
    channel: 'slack',
    threadId: 'auth-migration',
    daysAgo: 6,
  },
  {
    sender: 'Eve Liu',
    body: "I ran the auth migration branch through our security scanner. Found two issues: 1) CORS config is too permissive on /v2 routes, 2) refresh token rotation isn't enabled. Both are fixable.",
    channel: 'slack',
    threadId: 'auth-migration',
    daysAgo: 5,
  },

  // ---- Topic cluster: Design system ----
  {
    sender: 'Frank Wu',
    body: 'Shared the new design system components in Figma. Key changes: updated color tokens for accessibility (WCAG AA), new spacing scale, and a revised button hierarchy.',
    channel: 'slack',
    threadId: 'design-system',
    daysAgo: 8,
  },
  {
    sender: 'Carol Wang',
    body: "The new button styles look great Frank. Question: are we deprecating the ghost button variant? I see it's missing from the new spec.",
    channel: 'slack',
    threadId: 'design-system',
    daysAgo: 8,
  },
  {
    sender: 'Frank Wu',
    body: "Yes, ghost buttons are being replaced by tertiary buttons. Same visual weight but with better focus states. I'll update the migration guide.",
    channel: 'slack',
    threadId: 'design-system',
    daysAgo: 7,
  },

  // ---- Topic cluster: Production incident ----
  {
    sender: 'Bob Zhang',
    body: "INCIDENT: Payment service is returning 500s for ~15% of checkout requests. Looks like a connection pool exhaustion issue. I'm investigating.",
    channel: 'slack',
    threadId: 'incident-payments',
    daysAgo: 3,
  },
  {
    sender: 'Bob Zhang',
    body: 'Root cause found: the connection pool max was set to 10 but we had a query that was holding connections for 30s+ due to a missing index on orders.created_at. Deploying fix now.',
    channel: 'slack',
    threadId: 'incident-payments',
    daysAgo: 3,
  },
  {
    sender: 'Alice Chen',
    body: "Good catch Bob. Let's add a connection pool metric to our Grafana dashboard and set an alert at 80% utilization. Also need a post-mortem doc.",
    channel: 'slack',
    threadId: 'incident-payments',
    daysAgo: 3,
  },
  {
    sender: 'David Li',
    body: 'Post-mortem written up in Confluence. Action items: 1) Add missing DB indexes, 2) Set pool size to 50, 3) Add pool utilization alerts, 4) Review all long-running queries.',
    channel: 'slack',
    threadId: 'incident-payments',
    daysAgo: 2,
  },

  // ---- Topic cluster: Team social / misc ----
  {
    sender: 'Eve Liu',
    body: 'Team lunch this Thursday at 12:30 at the new ramen place on 3rd street. Please RSVP in the thread!',
    channel: 'slack',
    threadId: 'social',
    daysAgo: 4,
  },
  {
    sender: 'Frank Wu',
    body: 'Count me in! 🍜',
    channel: 'slack',
    threadId: 'social',
    daysAgo: 4,
  },

  // ---- Email items for variety ----
  {
    sender: 'Grace Huang',
    subject: 'Q3 Budget Approval',
    body: 'Hi team, the Q3 engineering budget has been approved. We have $150K for infrastructure upgrades and $80K for tooling. Please submit your requests by end of month.',
    channel: 'email',
    daysAgo: 12,
  },
  {
    sender: 'Alice Chen',
    subject: 'Re: Q3 Budget Approval',
    body: "Thanks Grace. I'd like to allocate $40K from infra budget for the Kubernetes cluster upgrade and $20K for Datadog APM licenses. Will send the formal request today.",
    channel: 'email',
    daysAgo: 11,
  },

  // ---- A note/document ----
  {
    sender: 'Bob Zhang',
    subject: 'Architecture Decision Record: Event-Driven Payments',
    body: 'ADR-042: We will move the payment processing pipeline from synchronous REST calls to an event-driven architecture using Kafka. Rationale: better resilience, easier retry logic, and decoupling from downstream services. Trade-offs: increased operational complexity and eventual consistency.',
    channel: 'file',
    daysAgo: 14,
  },
];

async function main() {
  console.log('Initializing MindFlow engine...');
  const engine = new MindFlowEngine();
  await engine.init();

  console.log(`\nInserting ${MOCK_MESSAGES.length} mock items...\n`);

  for (const msg of MOCK_MESSAGES) {
    const now = Date.now();
    const eventTime = now - msg.daysAgo * 24 * 60 * 60 * 1000;
    const contentHash = createHash('sha256').update(msg.body).digest('hex');

    // Check for duplicate
    const existing = engine.rawItems.findByHash(contentHash);
    if (existing) {
      console.log(`  [skip] duplicate: ${msg.body.slice(0, 60)}...`);
      continue;
    }

    const item: RawItem = {
      id: ulid(),
      sourceAdapter: SourceAdapterType.Filesystem,
      channel: msg.channel,
      externalId: ulid(),
      threadId: msg.threadId ?? null,
      senderEntityId: null,
      recipientEntityIds: [],
      subject: msg.subject ?? null,
      body: msg.body,
      bodyFormat: BodyFormat.Plaintext,
      contentHash,
      language: null,
      eventTime,
      ingestedAt: now,
      processingStatus: ProcessingStatus.Pending,
      attachments: [],
      metadata: {
        sender: msg.sender,
        recipients: msg.recipients ?? [],
        mockData: true,
      },
    };

    engine.rawItems.insert(item);

    // Enqueue for processing pipeline
    engine.jobs.enqueue({
      id: ulid(),
      rawItemId: item.id,
      stage: JobStage.Triage,
      status: 'pending' as any,
      attempts: 0,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
      error: null,
    });

    console.log(`  [+] ${msg.channel.padEnd(6)} ${msg.sender.padEnd(14)} ${msg.body.slice(0, 60)}...`);
  }

  console.log('\nRunning extraction pipeline (ingest)...');
  await engine.ingest();

  const stats = engine.getStats();
  console.log('\n--- Stats after ingestion ---');
  console.log(`  Raw items:    ${stats.rawItemCount}`);
  console.log(`  Entities:     ${stats.entityCount}`);
  console.log(`  Relationships: ${stats.relationshipCount ?? 'N/A'}`);
  console.log(`  Pending jobs: ${stats.pendingJobCount}`);
  console.log('\nDone! ✅');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
