/**
 * Seed script: generates 1000 realistic fake messages and populates a demo database.
 * Run with: npx tsx scripts/seed-demo-data.ts
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

import {
  MindFlowDatabase,
  RawItemRepository,
  EntityRepository,
  RelationshipRepository,
  ThreadRepository,
  AttentionItemRepository,
  EntityEpisodeRepository,
} from '../src/storage/index.js';
import { ProcessingPipeline } from '../src/processing/pipeline.js';
import { AttentionEngine } from '../src/attention/engine.js';
import { CommunityDetector } from '../src/graph/community.js';
import { TopicClusterer } from '../src/graph/clustering.js';
import {
  BodyFormat,
  DetectedLanguage,
  EntityStatus,
  EntityType,
  JobStage,
  JobStatus,
  ProcessingStatus,
  RelationshipType,
  SourceAdapterType,
  SourceChannel,
} from '../src/types/index.js';
import {
  AttentionItemRepository as _Att,
  JobQueueRepository,
} from '../src/storage/repositories.js';
import { ulid } from '../src/utils/ulid.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DB_PATH = join(homedir(), '.mindflow', 'demo.db');
mkdirSync(join(homedir(), '.mindflow'), { recursive: true });

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// ---------------------------------------------------------------------------
// Deterministic pseudo-random (seeded so the output is reproducible)
// ---------------------------------------------------------------------------

let seed = 42;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) & 0xffffffff;
  return (seed >>> 0) / 0xffffffff;
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)]!;
}
function pickN<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const result: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = randInt(0, copy.length - 1);
    result.push(copy.splice(idx, 1)[0]!);
  }
  return result;
}

// ---------------------------------------------------------------------------
// People data
// ---------------------------------------------------------------------------

interface Person {
  id: string;
  canonicalName: string;
  nameAlt: string | null;
  email: string;
  phone: string;
}

const PEOPLE: Omit<Person, 'id'>[] = [
  { canonicalName: 'Wang Zong', nameAlt: '王总', email: 'wang.zong@company.cn', phone: '+86-138-0000-1001' },
  { canonicalName: 'Lisa Chen', nameAlt: '陈丽莎', email: 'lisa.chen@company.com', phone: '+1-415-555-0101' },
  { canonicalName: 'Zhang San', nameAlt: '张三', email: 'zhang.san@vendor.cn', phone: '+86-139-0000-2002' },
  { canonicalName: 'Michael Liu', nameAlt: '刘迈克', email: 'michael.liu@company.com', phone: '+1-650-555-0202' },
  { canonicalName: 'Sarah Wong', nameAlt: '王莎拉', email: 'sarah.wong@company.com', phone: '+1-408-555-0303' },
  { canonicalName: 'David Park', nameAlt: null, email: 'david.park@partner.com', phone: '+1-213-555-0404' },
  { canonicalName: 'Li Wei', nameAlt: '李伟', email: 'li.wei@company.cn', phone: '+86-137-0000-3003' },
  { canonicalName: 'Jennifer Zhao', nameAlt: '赵珍妮', email: 'jennifer.zhao@company.com', phone: '+1-510-555-0505' },
  { canonicalName: 'Tom Zhang', nameAlt: '张汤姆', email: 'tom.zhang@vendor.com', phone: '+1-415-555-0606' },
  { canonicalName: 'Chen Mei', nameAlt: '陈梅', email: 'chen.mei@partner.cn', phone: '+86-135-0000-4004' },
  { canonicalName: 'Kevin Wu', nameAlt: '吴凯文', email: 'kevin.wu@company.com', phone: '+1-650-555-0707' },
  { canonicalName: 'Amy Lin', nameAlt: '林艾美', email: 'amy.lin@company.com', phone: '+1-408-555-0808' },
  { canonicalName: 'Robert He', nameAlt: '何罗伯特', email: 'robert.he@company.com', phone: '+1-415-555-0909' },
  { canonicalName: 'Xu Fang', nameAlt: '徐芳', email: 'xu.fang@vendor.cn', phone: '+86-136-0000-5005' },
  { canonicalName: 'Grace Luo', nameAlt: '罗格蕾斯', email: 'grace.luo@company.com', phone: '+1-213-555-1010' },
  { canonicalName: 'Peter Wang', nameAlt: '王彼得', email: 'peter.wang@company.com', phone: '+1-415-555-1111' },
  { canonicalName: 'Emily Sun', nameAlt: '孙艾米莉', email: 'emily.sun@company.com', phone: '+1-650-555-1212' },
  { canonicalName: 'Zhao Lei', nameAlt: '赵磊', email: 'zhao.lei@company.cn', phone: '+86-134-0000-6006' },
];

// ---------------------------------------------------------------------------
// Topics data
// ---------------------------------------------------------------------------

interface Topic {
  id: string;
  name: string;
  nameAlt: string | null;
}

const TOPICS: Omit<Topic, 'id'>[] = [
  { name: 'Q3 Budget', nameAlt: '第三季度预算' },
  { name: 'Vendor Selection', nameAlt: '供应商选择' },
  { name: 'Product Launch', nameAlt: '产品发布' },
  { name: 'Team Hiring', nameAlt: '团队招聘' },
  { name: 'Office Renovation', nameAlt: '办公室装修' },
  { name: 'Client Onboarding', nameAlt: '客户入职' },
  { name: 'Marketing Campaign', nameAlt: '营销活动' },
  { name: 'Contract Renewal', nameAlt: '合同续签' },
  { name: 'Annual Review', nameAlt: '年度评审' },
  { name: 'Tech Migration', nameAlt: '技术迁移' },
];

// ---------------------------------------------------------------------------
// Timestamp helpers (Jan–Mar 2026)
// ---------------------------------------------------------------------------

const START_TS = new Date('2026-01-01T08:00:00Z').getTime();
const END_TS = new Date('2026-03-28T18:00:00Z').getTime();

function randomTs(): number {
  return START_TS + Math.floor(rand() * (END_TS - START_TS));
}

function recentTs(baseTs: number, maxDeltaMs = 7 * 24 * 3600 * 1000): number {
  return baseTs + Math.floor(rand() * maxDeltaMs);
}

// ---------------------------------------------------------------------------
// Message body generators
// ---------------------------------------------------------------------------

function emailThread(
  topic: Omit<Topic, 'id'>,
  sender: Omit<Person, 'id'>,
  recipients: Omit<Person, 'id'>[],
  index: number,
): string {
  const templates = [
    () => `Hi ${recipients[0]?.canonicalName ?? 'team'},

Following up on our discussion about ${topic.name}. I wanted to confirm the timeline we agreed on last week.

The key deliverables are:
- Initial proposal by end of this week
- Review meeting scheduled for next Wednesday at 2pm
- Final approval needed before the 15th

Please send me your feedback by Friday so we can move forward. 这个项目对我们来说非常重要，请大家尽快确认。

Best,
${sender.canonicalName}`,

    () => `Hello ${recipients[0]?.canonicalName ?? 'all'},

Re: ${topic.name} — update from this morning's call.

王总 confirmed that the budget allocation for this quarter is approved at ¥${randInt(30, 80)}万. We need to finalize the vendor contracts before the end of March.

Action items:
- ${recipients[0]?.canonicalName}: prepare vendor comparison matrix by Thursday
- ${sender.canonicalName}: schedule review with finance team
- All: please review the attached proposal doc

The quote we received from ${pick(['TechCorp', 'GlobalSolutions', 'InnovateCo', 'Apex Systems'])} is $${randInt(35, 120)}K. 我觉得价格还有谈判空间。

Thanks,
${sender.canonicalName}`,

    () => `Team,

Quick update on ${topic.name}. We had a productive meeting with the client today.

Key points discussed:
1. They're happy with the current progress but need the report by March ${randInt(10, 28)}
2. Budget confirmed at $${randInt(50, 200)}K for Phase 1
3. Next milestone: beta release by end of Q1

${topic.nameAlt}方面，客户对我们的进度表示满意。他们特别强调了交付日期的重要性。

Please confirm your availability for the kickoff meeting next week. 需要大家周一前回复。

Regards,
${sender.canonicalName}
${sender.email}`,

    () => `Hi all,

I need your input on ${topic.name} before the board meeting on March ${randInt(15, 25)}.

${recipients.map((r) => `- ${r.canonicalName}: can you please provide your section by tomorrow COB?`).join('\n')}

王总 mentioned in our last sync that we're behind on this. Let's make sure we present a unified view.

预算方面，我们目前还差¥${randInt(5, 20)}万的资金缺口。这需要在下次董事会上解决。

The deadline is firm — please prioritize this.

${sender.canonicalName}`,
  ];

  return templates[index % templates.length]!();
}

function imessageThread(
  topic: Omit<Topic, 'id'>,
  sender: Omit<Person, 'id'>,
  recipient: Omit<Person, 'id'>,
  index: number,
): string {
  const templates = [
    () => `${recipient.canonicalName} 你好，关于${topic.nameAlt ?? topic.name}的事情，王总刚刚打电话说需要在本周五之前提交报告。你这边准备好了吗？`,
    () => `Hey ${recipient.canonicalName}, just saw your email about ${topic.name}. Can we jump on a quick call? The $${randInt(20, 80)}K quote looks high to me`,
    () => `${recipient.canonicalName}，合同那边怎么样了？客户说要周三前签字。我这边已经准备好了，就等你的了`,
    () => `Quick heads up — the ${topic.name} meeting got moved to 3pm tomorrow. David Park can't make it at 2. 你能调整时间吗？`,
    () => `${recipient.canonicalName} 好消息！客户刚刚确认了，预算批了¥${randInt(20, 50)}万。${topic.nameAlt ?? topic.name}可以正式启动了！`,
    () => `Hey, did you see the email from ${pick(['Wang Zong', 'Lisa Chen', 'the client', 'the vendor'])} about ${topic.name}? We need to respond today`,
    () => `${recipient.canonicalName}，你有空吗？我有个关于${topic.nameAlt ?? topic.name}的问题想问你，大概5分钟就够`,
    () => `Reminder: ${topic.name} review is at 10am. Please bring the updated numbers. 别忘了带上最新的数据！`,
    () => `${recipient.canonicalName} 我刚收到供应商的报价，比预期高了${randInt(10, 30)}%。需要你来帮我谈判`,
    () => `关于${topic.nameAlt ?? topic.name}，张总那边说可以给我们延期到${randInt(1, 28)}号，但条件是要先付30%的定金`,
  ];

  return templates[index % templates.length]!();
}

function meetingNote(
  topic: Omit<Topic, 'id'>,
  attendees: Omit<Person, 'id'>[],
  index: number,
): string {
  const date = new Date(randomTs());
  const dateStr = date.toISOString().split('T')[0];
  const templates = [
    () => `# ${topic.name} — Meeting Notes
Date: ${dateStr}
Attendees: ${attendees.map((a) => a.canonicalName).join(', ')}

## Summary
Productive discussion on ${topic.name}. Wang Zong opened with a review of current status.

## Key Decisions
- Budget approved at $${randInt(100, 500)}K for the full project
- Vendor shortlist narrowed to 3 candidates
- Go-live target: April ${randInt(1, 30)}, 2026

## Action Items
- [ ] ${attendees[0]?.canonicalName}: Draft vendor evaluation criteria by Friday
- [ ] ${attendees[1]?.canonicalName ?? attendees[0]?.canonicalName}: Schedule follow-up with finance
- [ ] All: Review proposal doc before next meeting

## Notes
${topic.nameAlt ?? topic.name}方面，我们达成了以下共识：
1. 项目预算为¥${randInt(50, 200)}万，已通过董事会审批
2. 供应商选择将在本月底前完成
3. 项目启动时间定为下个季度初

Next meeting: ${new Date(date.getTime() + 7 * 24 * 3600 * 1000).toISOString().split('T')[0]} at 2:00 PM`,

    () => `# Weekly Sync — ${topic.name}
${dateStr} | Duration: 45 min
Present: ${attendees.map((a) => a.canonicalName).join(', ')}

## Status Update
Overall progress: ${randInt(40, 85)}% complete

### Blockers
- Waiting on legal review of vendor contract (expected by end of week)
- IT infrastructure provisioning delayed by ${randInt(3, 14)} days
- 客户方面还没有确认最终需求文档

### Completed This Week
- Stakeholder interviews completed (${randInt(8, 15)} of ${randInt(15, 20)} done)
- Initial design mockups reviewed and approved
- Budget reconciliation finished — we're ${randInt(2, 8)}% under budget 🎉

### Next Steps
${attendees.slice(0, 3).map((a, i) => `- ${a.canonicalName}: ${pick(['Complete risk assessment', 'Finalize vendor negotiations', 'Update project timeline', 'Prepare executive presentation', 'Review contract terms'])}`).join('\n')}

The deadline is March ${randInt(15, 31)} — 请所有人优先处理这个项目。`,

    () => `## ${topic.name} — Quick Standup Notes
${dateStr}

**What's done:**
- 合同草稿已完成，等待法务审查
- Vendor demos scheduled for next week
- Team capacity confirmed for Q1

**Blockers:**
- Need signoff from 王总 on the $${randInt(50, 150)}K line item
- David Park on PTO until ${randInt(1, 14)} March
- Client hasn't responded to our proposal from last week — following up today

**Today's priorities:**
1. ${attendees[0]?.canonicalName}: finalize the RFP document
2. Send updated project schedule to all stakeholders
3. 准备下周董事会的汇报材料

**Decisions made:**
- Go with Option B for the tech architecture (see Confluence doc)
- Extend timeline by 2 weeks to accommodate client feedback
- Budget reallocation approved: move ¥${randInt(5, 20)}万 from Phase 2 to Phase 1`,
  ];

  return templates[index % templates.length]!();
}

// ---------------------------------------------------------------------------
// Subject line generators
// ---------------------------------------------------------------------------

function emailSubject(topic: Omit<Topic, 'id'>, isReply: boolean, index: number): string {
  const subjects = [
    `${topic.name} — Action Required by Friday`,
    `Re: ${topic.name} Update`,
    `[URGENT] ${topic.name} deadline approaching`,
    `${topic.name}: Review needed`,
    `Follow-up: ${topic.name} discussion`,
    `FWD: ${topic.name} — vendor proposal`,
    `${topic.name} — Q1 2026 status report`,
    `Quick question re: ${topic.name}`,
    `${topic.nameAlt ?? topic.name} - 需要确认`,
    `${topic.name} meeting recap`,
    `Re: Re: ${topic.name} — final decision`,
  ];
  const base = subjects[index % subjects.length]!;
  return isReply ? `Re: ${base.replace(/^Re: /, '')}` : base;
}

// ---------------------------------------------------------------------------
// Main seed function
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Remove existing demo database for a clean slate
  if (existsSync(DB_PATH)) {
    rmSync(DB_PATH, { force: true });
    // Also remove WAL/SHM files if present
    rmSync(`${DB_PATH}-wal`, { force: true });
    rmSync(`${DB_PATH}-shm`, { force: true });
    console.log('Removed existing demo.db');
  }

  console.log(`Creating demo database at ${DB_PATH}...`);

  const mfdb = new MindFlowDatabase(DB_PATH);
  const db = mfdb.db;

  const rawItems = new RawItemRepository(db);
  const entities = new EntityRepository(db);
  const relationships = new RelationshipRepository(db);
  const threads = new ThreadRepository(db);
  const attentionItems = new AttentionItemRepository(db);
  const jobs = new JobQueueRepository(db);
  const entityEpisodes = new EntityEpisodeRepository(db);

  // -----------------------------------------------------------------------
  // 1. Create entity records for all people
  // -----------------------------------------------------------------------

  console.log('Creating person entities...');
  const now = Date.now();

  const people: Person[] = PEOPLE.map((p) => ({
    ...p,
    id: ulid(),
  }));

  for (const person of people) {
    entities.insert({
      id: person.id,
      type: EntityType.Person,
      canonicalName: person.canonicalName,
      nameAlt: person.nameAlt,
      aliases: [person.email, person.phone],
      attributes: { email: person.email, phone: person.phone },
      confidence: 1.0,
      status: EntityStatus.Active,
      mergedInto: null,
      firstSeenAt: START_TS,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  // -----------------------------------------------------------------------
  // 2. Create topic entities
  // -----------------------------------------------------------------------

  console.log('Creating topic entities...');
  const topicEntities: Topic[] = TOPICS.map((t) => ({ ...t, id: ulid() }));

  for (const topic of topicEntities) {
    entities.insert({
      id: topic.id,
      type: EntityType.Topic,
      canonicalName: topic.name,
      nameAlt: topic.nameAlt,
      aliases: topic.nameAlt ? [topic.nameAlt] : [],
      attributes: {},
      confidence: 1.0,
      status: EntityStatus.Active,
      mergedInto: null,
      firstSeenAt: START_TS,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  // -----------------------------------------------------------------------
  // 3. Create CommunicatesWith relationships between people
  // -----------------------------------------------------------------------

  console.log('Creating relationships...');

  // Core communication pairs
  const commPairs: Array<[number, number]> = [
    [0, 1], [0, 2], [0, 3], [1, 3], [1, 4], [2, 5], [3, 6],
    [4, 7], [5, 8], [6, 9], [7, 10], [8, 11], [9, 12], [10, 13],
    [11, 14], [12, 15], [13, 16], [14, 17], [0, 5], [1, 6], [2, 7],
  ];

  for (const [i, j] of commPairs) {
    if (people[i] && people[j]) {
      relationships.insert({
        id: ulid(),
        fromEntityId: people[i]!.id,
        toEntityId: people[j]!.id,
        type: RelationshipType.CommunicatesWith,
        strength: 0.5 + rand() * 0.5,
        eventTime: randomTs(),
        ingestionTime: now,
        validFrom: null,
        validUntil: null,
        occurrenceCount: randInt(1, 20),
        sourceItemIds: [],
        metadata: {},
      });
    }
  }

  // Person → Topic (discusses) relationships
  for (let i = 0; i < people.length; i++) {
    const topicsForPerson = pickN(topicEntities, randInt(2, 5));
    for (const topic of topicsForPerson) {
      relationships.insert({
        id: ulid(),
        fromEntityId: people[i]!.id,
        toEntityId: topic.id,
        type: RelationshipType.Discusses,
        strength: 0.3 + rand() * 0.7,
        eventTime: randomTs(),
        ingestionTime: now,
        validFrom: null,
        validUntil: null,
        occurrenceCount: randInt(1, 10),
        sourceItemIds: [],
        metadata: {},
      });
    }
  }

  // -----------------------------------------------------------------------
  // 4. Create threads
  // -----------------------------------------------------------------------

  console.log('Creating threads and thread entities...');

  interface ThreadRecord { id: string; topic: Omit<Topic, 'id'>; subject: string; entityId: string; participants: Person[] }
  const threadRecords: ThreadRecord[] = [];

  for (let i = 0; i < 60; i++) {
    const topic = pick(TOPICS);
    const subject = emailSubject(topic, false, i);
    const threadId = ulid();
    const threadEntityId = ulid();
    const participants = pickN(people, randInt(2, 5));
    const firstMsgAt = randomTs();
    // externalThreadId on the Thread entity must equal ri.thread_id (the value stored
    // in raw_items.thread_id) so CrossChannelLinker can resolve:
    //   json_extract(e.attributes, '$.externalThreadId') = ri.thread_id
    const externalThreadId = threadId;

    threadRecords.push({ id: threadId, topic, subject, entityId: threadEntityId, participants });

    threads.insert({
      id: threadId,
      sourceAdapter: SourceAdapterType.Gmail,
      channel: SourceChannel.Email,
      externalThreadId: `gmail-thread-${threadId}`,
      subject,
      participantEntityIds: participants.map((p) => p.id),
      messageCount: randInt(2, 8),
      firstMessageAt: firstMsgAt,
      lastMessageAt: recentTs(firstMsgAt),
      summary: null,
      status: 'active',
    });

    // Create a Thread entity — externalThreadId must match raw_items.thread_id
    entities.insert({
      id: threadEntityId,
      type: EntityType.Thread,
      canonicalName: subject,
      nameAlt: null,
      aliases: [externalThreadId],
      attributes: { externalThreadId, channel: SourceChannel.Email, subject },
      confidence: 1.0,
      status: EntityStatus.Active,
      mergedInto: null,
      firstSeenAt: firstMsgAt,
      lastSeenAt: recentTs(firstMsgAt),
      createdAt: now,
      updatedAt: now,
    });
  }

  // -----------------------------------------------------------------------
  // 5. Generate raw items
  // -----------------------------------------------------------------------

  console.log('Generating 1000 raw items...');

  const allItems: string[] = [];
  let emailCount = 0;
  let imessageCount = 0;
  let docCount = 0;

  // Track raw items with their timestamps and sender for episode creation
  interface RawItemRecord { id: string; eventTime: number; senderId: string | null; channel: SourceChannel; threadId: string | null }
  const rawItemRecords: RawItemRecord[] = [];

  // Helper to insert one raw item
  function insertRawItem(params: {
    adapter: SourceAdapterType;
    channel: SourceChannel;
    subject: string | null;
    body: string;
    language: DetectedLanguage;
    eventTime: number;
    threadId?: string;
    senderId?: string;
  }): string {
    const id = ulid();
    const item = {
      id,
      sourceAdapter: params.adapter,
      channel: params.channel,
      externalId: `ext-${id}`,
      threadId: params.threadId ?? null,
      senderEntityId: params.senderId ?? null,
      recipientEntityIds: [],
      subject: params.subject,
      body: params.body,
      bodyFormat: BodyFormat.Plaintext,
      contentHash: sha256(id + params.body),
      language: params.language,
      eventTime: params.eventTime,
      ingestedAt: params.eventTime + randInt(1000, 60000),
      processingStatus: ProcessingStatus.Pending,
      attachments: [],
      metadata: {},
    };
    rawItems.insert(item);
    allItems.push(id);
    rawItemRecords.push({
      id,
      eventTime: params.eventTime,
      senderId: params.senderId ?? null,
      channel: params.channel,
      threadId: params.threadId ?? null,
    });
    return id;
  }

  // --- Emails (400) ---
  // 60 threads × ~4-6 emails each + standalone emails
  for (let t = 0; t < 60 && emailCount < 400; t++) {
    const thread = threadRecords[t % threadRecords.length]!;
    const msgCount = randInt(3, 7);
    let baseTs = randomTs();
    // Use the thread's actual participants (set during thread creation)
    const threadParticipants = thread.participants.length >= 2 ? thread.participants : pickN(people, randInt(2, 4));

    for (let m = 0; m < msgCount && emailCount < 400; m++) {
      const sender = threadParticipants[m % threadParticipants.length]!;
      const recipients = threadParticipants.filter((p) => p.id !== sender.id);
      const isReply = m > 0;
      const subject = isReply
        ? `Re: ${thread.subject}`
        : thread.subject;
      const body = emailThread(thread.topic, sender, recipients, m);
      const lang = rand() < 0.35 ? DetectedLanguage.Chinese : (rand() < 0.3 ? DetectedLanguage.Mixed : DetectedLanguage.English);

      insertRawItem({
        adapter: SourceAdapterType.Gmail,
        channel: SourceChannel.Email,
        subject,
        body,
        language: lang,
        eventTime: baseTs,
        threadId: thread.id,
        senderId: sender.id,
      });
      emailCount++;
      baseTs = recentTs(baseTs, 2 * 24 * 3600 * 1000);
    }
  }

  // Fill remaining emails as standalone
  while (emailCount < 400) {
    const topic = pick(TOPICS);
    const sender = pick(people);
    const recipient = pick(people.filter((p) => p.id !== sender.id));
    const body = emailThread(topic, sender, [recipient], emailCount);
    const subject = emailSubject(topic, false, emailCount);
    insertRawItem({
      adapter: SourceAdapterType.Gmail,
      channel: SourceChannel.Email,
      subject,
      body,
      language: rand() < 0.4 ? DetectedLanguage.Mixed : DetectedLanguage.English,
      eventTime: randomTs(),
      senderId: sender.id,
    });
    emailCount++;
  }

  // --- iMessages (400) ---
  for (let i = 0; i < 400; i++) {
    const topic = pick(TOPICS);
    const sender = pick(people);
    const recipient = pick(people.filter((p) => p.id !== sender.id));
    const body = imessageThread(topic, sender, recipient, i);
    const lang = rand() < 0.5 ? DetectedLanguage.Chinese : (rand() < 0.3 ? DetectedLanguage.Mixed : DetectedLanguage.English);

    insertRawItem({
      adapter: SourceAdapterType.IMessage,
      channel: SourceChannel.IMessage,
      subject: null,
      body,
      language: lang,
      eventTime: randomTs(),
      senderId: sender.id,
    });
    imessageCount++;
  }

  // --- Meeting notes / documents (200) ---
  for (let i = 0; i < 200; i++) {
    const topic = pick(TOPICS);
    const attendees = pickN(people, randInt(3, 6));
    const body = meetingNote(topic, attendees, i);

    insertRawItem({
      adapter: SourceAdapterType.Filesystem,
      channel: SourceChannel.File,
      subject: `${topic.name} — Meeting Notes`,
      body,
      language: DetectedLanguage.Mixed,
      eventTime: randomTs(),
    });
    docCount++;
  }

  console.log(`Inserted: ${emailCount} emails, ${imessageCount} iMessages, ${docCount} docs`);

  // -----------------------------------------------------------------------
  // 6. Run Tier 1 + Tier 2 extraction on all items via ProcessingPipeline
  // -----------------------------------------------------------------------

  console.log('Running Tier 1 + Tier 2 extraction...');

  // Enqueue all items for processing
  const enqueueNow = Date.now();
  for (const itemId of allItems) {
    jobs.enqueue({
      id: ulid(),
      rawItemId: itemId,
      stage: JobStage.Triage,
      status: JobStatus.Pending,
      priority: 0,
      attempts: 0,
      maxAttempts: 3,
      lastError: null,
      createdAt: enqueueNow,
      startedAt: null,
      completedAt: null,
    });
  }

  // Use MockProvider (no LLM) with Tier 3 disabled
  const { MockProvider } = await import('../src/llm/provider.js');
  const pipeline = new ProcessingPipeline(
    { rawItems, jobQueue: jobs },
    new MockProvider(),
    { enableTier3: false, concurrency: 10 },
  );

  let processed = 0;
  let batch: number;
  do {
    batch = await pipeline.processBatch();
    processed += batch;
    if (processed % 100 === 0 && processed > 0) {
      process.stdout.write(`  processed ${processed}/${allItems.length}...\r`);
    }
  } while (batch > 0);
  console.log(`  processed ${processed}/${allItems.length} items        `);

  // -----------------------------------------------------------------------
  // 7. Create entity-episode links
  //    a) Link senders to their own messages (authoritative)
  //    b) Link topic entities to messages that discuss them
  //    c) Create cross-channel episodes: same person, different channels, within 24h
  // -----------------------------------------------------------------------

  console.log('Creating entity episodes...');
  let episodeCount = 0;

  // a) Sender episodes — every raw item links back to its sender
  for (const rec of rawItemRecords) {
    if (!rec.senderId) continue;
    entityEpisodes.insert({
      entityId: rec.senderId,
      rawItemId: rec.id,
      extractionMethod: 'tier1_rules',
      confidence: 0.95,
    });
    episodeCount++;
  }

  // b) Topic episodes — randomly assign 2-4 topic entities to each item
  for (const rec of rawItemRecords) {
    if (rand() > 0.6) continue; // ~60% of items get topic episodes
    const itemTopics = pickN(topicEntities, randInt(1, 3));
    for (const topic of itemTopics) {
      entityEpisodes.insert({
        entityId: topic.id,
        rawItemId: rec.id,
        extractionMethod: 'tier1_rules',
        confidence: 0.7 + rand() * 0.3,
      });
      episodeCount++;
    }
  }

  // c) Cross-channel pairs: create iMessage "threads" that represent continuations
  //    of email conversations. Directly record the thread entity pairs so we can
  //    insert ContinuesIn relationships without relying on time-window matching.
  console.log('Creating cross-channel episode pairs...');
  const crossChannelWindow = 12 * 60 * 60 * 1000; // 12 hours
  const threadsForCrossChannel = pickN(threadRecords, 20);
  let crossChannelPairCount = 0;

  // Store pairs of thread entity IDs for direct relationship insertion later
  const crossChannelThreadPairs: Array<{ emailThreadEntityId: string; imsgThreadEntityId: string; eventTime: number }> = [];

  for (const thread of threadsForCrossChannel) {
    // Find an email item in this thread
    const emailItems = rawItemRecords.filter(
      (r) => r.threadId === thread.id && r.channel === SourceChannel.Email,
    );
    if (emailItems.length === 0) continue;

    const emailItem = pick(emailItems);
    const sender = thread.participants[0];
    if (!sender) continue;
    const recipient = thread.participants[1] ?? pick(people);

    // Create an iMessage "thread" entity so CrossChannelLinker can form a link
    const imsgThreadId = ulid();
    // imsgExternalThreadId must equal what raw_items.thread_id will store
    const imsgExternalThreadId = imsgThreadId;
    const imsgTs = emailItem.eventTime + randInt(30 * 60 * 1000, crossChannelWindow);

    threads.insert({
      id: imsgThreadId,
      sourceAdapter: SourceAdapterType.IMessage,
      channel: SourceChannel.IMessage,
      externalThreadId: `imessage-thread-${imsgThreadId}`,
      subject: null,
      participantEntityIds: [sender.id, recipient.id],
      messageCount: 1,
      firstMessageAt: imsgTs,
      lastMessageAt: imsgTs,
      summary: null,
      status: 'active',
    });

    const imsgThreadEntityId = ulid();
    entities.insert({
      id: imsgThreadEntityId,
      type: EntityType.Thread,
      canonicalName: `iMessage: ${sender.canonicalName} — ${recipient.canonicalName}`,
      nameAlt: null,
      aliases: [imsgExternalThreadId],
      attributes: { externalThreadId: imsgExternalThreadId, channel: SourceChannel.IMessage },
      confidence: 1.0,
      status: EntityStatus.Active,
      mergedInto: null,
      firstSeenAt: imsgTs,
      lastSeenAt: imsgTs,
      createdAt: now,
      updatedAt: now,
    });

    const imsgBody = imessageThread(thread.topic, sender, recipient, crossChannelPairCount);
    const imsgId = insertRawItem({
      adapter: SourceAdapterType.IMessage,
      channel: SourceChannel.IMessage,
      subject: null,
      body: imsgBody,
      language: rand() < 0.4 ? DetectedLanguage.Chinese : DetectedLanguage.English,
      eventTime: imsgTs,
      threadId: imsgThreadId,
      senderId: sender.id,
    });
    imessageCount++;

    // Link the sender to both the email item and iMessage item so the linker
    // sees the same entity (sender) in both channels within the 24h window.
    // The iMessage episode is new; the email episode ensures the pairing works
    // even if the email item was sent by a different thread participant.
    entityEpisodes.insert({
      entityId: sender.id,
      rawItemId: imsgId,
      extractionMethod: 'tier1_rules',
      confidence: 0.95,
    });
    episodeCount++;
    // Ensure sender also has an episode on the paired email item
    const existingEmailEp = db.prepare(
      'SELECT 1 FROM entity_episodes WHERE entity_id = ? AND raw_item_id = ? LIMIT 1'
    ).get(sender.id, emailItem.id);
    if (!existingEmailEp) {
      entityEpisodes.insert({
        entityId: sender.id,
        rawItemId: emailItem.id,
        extractionMethod: 'cross_channel_seed',
        confidence: 0.8,
      });
      episodeCount++;
    }

    crossChannelThreadPairs.push({
      emailThreadEntityId: thread.entityId,
      imsgThreadEntityId,
      eventTime: imsgTs,
    });
    crossChannelPairCount++;
  }

  console.log(`Created ${episodeCount} entity episodes (${crossChannelPairCount} cross-channel pairs set up)`);

  // -----------------------------------------------------------------------
  // 8. Create some action item entities and unanswered-request attention items
  // -----------------------------------------------------------------------

  console.log('Creating action items and attention signals...');

  const actionItemTexts = [
    { name: 'Send Q3 budget report to Wang Zong', nameAlt: '向王总发送第三季度预算报告' },
    { name: 'Review vendor contract before March 15', nameAlt: '在3月15日前审查供应商合同' },
    { name: 'Prepare product launch presentation', nameAlt: '准备产品发布演示文稿' },
    { name: 'Schedule hiring interviews for backend team', nameAlt: '安排后端团队面试' },
    { name: 'Confirm office renovation timeline', nameAlt: '确认办公室装修时间表' },
    { name: 'Send onboarding materials to new client', nameAlt: '向新客户发送入职材料' },
    { name: 'Finalize marketing campaign copy', nameAlt: '完成营销活动文案' },
    { name: 'Get sign-off on contract renewal terms', nameAlt: '获得合同续签条款的批准' },
    { name: 'Complete annual performance reviews', nameAlt: '完成年度绩效考核' },
    { name: 'Migrate legacy database to new infrastructure', nameAlt: '将旧数据库迁移到新基础设施' },
    { name: 'Follow up with Zhang San on pricing', nameAlt: '跟张三跟进价格问题' },
    { name: 'Respond to client proposal by Friday', nameAlt: '周五前回复客户提案' },
  ];

  const actionItemEntityIds: string[] = [];
  for (const ai of actionItemTexts) {
    const id = ulid();
    actionItemEntityIds.push(id);
    entities.insert({
      id,
      type: EntityType.ActionItem,
      canonicalName: ai.name,
      nameAlt: ai.nameAlt,
      aliases: [],
      attributes: {},
      confidence: 0.9,
      status: EntityStatus.Active,
      mergedInto: null,
      firstSeenAt: randomTs(),
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  // -----------------------------------------------------------------------
  // 9. Run attention engine
  // -----------------------------------------------------------------------

  console.log('Running attention engine...');

  const attEngine = new AttentionEngine(db, attentionItems, entities, rawItems);
  const newAttentionItems = attEngine.detectAll();
  console.log(`Detected ${newAttentionItems.length} attention items`);

  // Also manually create some specific unanswered-request attention items
  // to ensure there's rich data for the demo
  const manualAttentionItems = [
    {
      title: 'Unanswered: vendor pricing follow-up from Zhang San',
      description: '张三 asked about the $42K quote 5 days ago — no response yet',
      entityId: people.find((p) => p.canonicalName === 'Zhang San')?.id ?? null,
      urgency: 0.9,
    },
    {
      title: 'Approaching deadline: Q3 Budget report due March 15',
      description: 'Wang Zong needs the Q3 budget analysis. Due in 3 days.',
      entityId: topicEntities.find((t) => t.name === 'Q3 Budget')?.id ?? null,
      urgency: 0.95,
    },
    {
      title: 'Unanswered: Client onboarding materials request',
      description: 'David Park asked for onboarding docs 4 days ago. Still pending.',
      entityId: people.find((p) => p.canonicalName === 'David Park')?.id ?? null,
      urgency: 0.8,
    },
    {
      title: 'Approaching deadline: Contract renewal by March 31',
      description: 'Lisa Chen flagged the vendor contract expires March 31. No action taken.',
      entityId: topicEntities.find((t) => t.name === 'Contract Renewal')?.id ?? null,
      urgency: 0.85,
    },
    {
      title: 'Unanswered: Team hiring approvals from HR',
      description: 'Jennifer Zhao requested headcount approval 6 days ago.',
      entityId: people.find((p) => p.canonicalName === 'Jennifer Zhao')?.id ?? null,
      urgency: 0.7,
    },
    {
      title: 'No response to Product Launch proposal',
      description: 'The product launch proposal was sent to 王总 last week with no reply.',
      entityId: topicEntities.find((t) => t.name === 'Product Launch')?.id ?? null,
      urgency: 0.75,
    },
  ];

  for (const item of manualAttentionItems) {
    attentionItems.insert({
      id: ulid(),
      type: item.urgency > 0.88
        ? 'approaching_deadline' as never
        : 'unanswered_request' as never,
      entityId: item.entityId,
      rawItemId: pick(allItems),
      urgencyScore: item.urgency,
      title: item.title,
      description: item.description,
      detectedAt: now - randInt(1, 5) * 24 * 3600 * 1000,
      resolvedAt: null,
      dismissedAt: null,
      snoozedUntil: null,
      resolutionType: null,
    });
  }

  // -----------------------------------------------------------------------
  // 10. Run community detection
  // -----------------------------------------------------------------------

  console.log('Running community detection...');
  const communityDetector = new CommunityDetector(db);
  const detectedCommunities = communityDetector.detectCommunities();
  console.log(`Detected ${detectedCommunities.length} communities`);
  for (const { community } of detectedCommunities) {
    console.log(`  - ${community.name} (${community.memberEntityIds.length} members)`);
  }

  // -----------------------------------------------------------------------
  // 11. Insert cross-channel ContinuesIn relationships directly.
  //     CrossChannelLinker uses a real-time sliding window that doesn't fit
  //     historical seed data spread across months. Insert the known pairs directly.
  // -----------------------------------------------------------------------

  console.log('Inserting cross-channel continuation links...');
  const insertContinuesIn = db.prepare(`
    INSERT INTO relationships (
      id, from_entity_id, to_entity_id, type, strength,
      event_time, ingestion_time, valid_from, valid_until,
      occurrence_count, source_item_ids, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const pair of crossChannelThreadPairs) {
    insertContinuesIn.run(
      ulid(),
      pair.emailThreadEntityId,
      pair.imsgThreadEntityId,
      RelationshipType.ContinuesIn,
      0.7,
      pair.eventTime,
      now,
      null,
      null,
      1,
      JSON.stringify([]),
      JSON.stringify({ fromChannel: SourceChannel.Email, toChannel: SourceChannel.IMessage }),
    );
  }
  console.log(`Inserted ${crossChannelThreadPairs.length} cross-channel continuation links`);

  // -----------------------------------------------------------------------
  // 12. Run topic clustering
  // -----------------------------------------------------------------------

  console.log('Running topic clustering...');
  const topicClusterer = new TopicClusterer(db);
  const clusteringStats = topicClusterer.clusterTopics();
  console.log(`Clustering: ${clusteringStats.topicsCreated} topics created, ${clusteringStats.topicsUpdated} updated, ${clusteringStats.driftDetected} drift detected`);

  // -----------------------------------------------------------------------
  // 13. Print summary stats
  // -----------------------------------------------------------------------

  console.log('\n=== Demo Database Summary ===');

  const rawItemCount = (db.prepare('SELECT COUNT(*) as n FROM raw_items').get() as { n: number }).n;
  const entityCount = (db.prepare("SELECT COUNT(*) as n FROM entities WHERE status != 'merged'").get() as { n: number }).n;
  const personCount = (db.prepare("SELECT COUNT(*) as n FROM entities WHERE type = 'person' AND status != 'merged'").get() as { n: number }).n;
  const topicCount = (db.prepare("SELECT COUNT(*) as n FROM entities WHERE type = 'topic' AND status != 'merged'").get() as { n: number }).n;
  const threadEntityCount = (db.prepare("SELECT COUNT(*) as n FROM entities WHERE type = 'thread' AND status != 'merged'").get() as { n: number }).n;
  const actionCount = (db.prepare("SELECT COUNT(*) as n FROM entities WHERE type = 'action_item' AND status != 'merged'").get() as { n: number }).n;
  const relCount = (db.prepare('SELECT COUNT(*) as n FROM relationships WHERE valid_until IS NULL').get() as { n: number }).n;
  const crossChannelRelCount = (db.prepare("SELECT COUNT(*) as n FROM relationships WHERE type = 'continues_in' AND valid_until IS NULL").get() as { n: number }).n;
  const threadCount = (db.prepare('SELECT COUNT(*) as n FROM threads').get() as { n: number }).n;
  const communityCount = (db.prepare('SELECT COUNT(*) as n FROM communities').get() as { n: number }).n;
  const attentionCount = (db.prepare('SELECT COUNT(*) as n FROM attention_items WHERE resolved_at IS NULL AND dismissed_at IS NULL').get() as { n: number }).n;
  const episodeCountFinal = (db.prepare('SELECT COUNT(*) as n FROM entity_episodes').get() as { n: number }).n;
  const doneCount = (db.prepare("SELECT COUNT(*) as n FROM raw_items WHERE processing_status = 'done'").get() as { n: number }).n;
  const emailFinal = (db.prepare("SELECT COUNT(*) as n FROM raw_items WHERE source_adapter = 'gmail'").get() as { n: number }).n;
  const imsgFinal = (db.prepare("SELECT COUNT(*) as n FROM raw_items WHERE source_adapter = 'imessage'").get() as { n: number }).n;
  const docFinal = (db.prepare("SELECT COUNT(*) as n FROM raw_items WHERE source_adapter = 'filesystem'").get() as { n: number }).n;

  console.log(`\nRaw items:           ${rawItemCount} total`);
  console.log(`  Emails:            ${emailFinal}`);
  console.log(`  iMessages:         ${imsgFinal}`);
  console.log(`  Documents:         ${docFinal}`);
  console.log(`  Processed:         ${doneCount}`);
  console.log(`\nEntities:            ${entityCount} total`);
  console.log(`  People:            ${personCount}`);
  console.log(`  Topics:            ${topicCount}`);
  console.log(`  Threads:           ${threadEntityCount}`);
  console.log(`  Action items:      ${actionCount}`);
  console.log(`\nRelationships:       ${relCount}`);
  console.log(`  Cross-channel:     ${crossChannelRelCount}`);
  console.log(`Threads (table):      ${threadCount}`);
  console.log(`Communities:          ${communityCount}`);
  console.log(`Entity episodes:      ${episodeCountFinal}`);
  console.log(`Attention items:      ${attentionCount} pending`);
  console.log(`\nDatabase:            ${DB_PATH}`);
  console.log('\nDone! Run: mindflow status --db ~/.mindflow/demo.db');

  mfdb.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
