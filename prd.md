# MindFlow — AI-Powered Personal Knowledge Index

## Product Requirements Document v1.0

**An OpenClaw Plugin for Unified Communication Intelligence**

Version 1.0 · March 28, 2026 · Confidential

---

## 1. Executive Summary

MindFlow is an AI-powered OpenClaw plugin that continuously indexes all personal communications and documents — email, iMessage, meeting notes, and work files — into a unified, searchable knowledge base. It automatically extracts entities (people, topics, action items, key facts) and builds a layered knowledge graph that users can visually browse through progressive disclosure, or query via natural language.

The core value proposition: **you never lose information again.** Everything you've discussed with anyone, across any channel, becomes instantly findable and visually explorable — without any manual effort.

---

## 2. Problem Statement

### 2.1 The information fragmentation problem

Knowledge workers today receive hundreds of messages daily across email, iMessage, Slack, meeting notes, and shared documents. Critical information — decisions made, commitments given, key facts shared — gets buried across these channels and becomes effectively lost within days.

### 2.2 Current solutions fall short

- **Email search**: Only searches one channel. Cannot find "that thing Wang Zong mentioned" if it was in iMessage.
- **Note-taking apps (Obsidian, Notion)**: Require manual input. Users must actively choose to capture information, creating a permanent gap between what they receive and what they record.
- **PKM tools (Recall, Heptabase)**: Designed for web content consumption, not for personal communication indexing. No native email/iMessage ingestion.
- **AI memory plugins (Cognee, Graphiti)**: Index the agent's own conversation history, not the user's external communications.

### 2.3 The result

Users forget commitments, lose track of important decisions, fail to follow up, and waste significant time searching for information they know they received but cannot locate.

---

## 3. Target User

### 3.1 Primary persona

Knowledge workers who manage many relationships and projects simultaneously: product managers, engineering leads, consultants, founders, senior ICs. They communicate across email and iMessage daily, handle both Chinese and English correspondence, and frequently think "I know someone told me this, but I can't find it."

### 3.2 User profile

| Attribute | Description |
|-----------|-------------|
| Platform | macOS (OpenClaw runs locally) |
| Communication volume | 50–200+ messages/day across email and iMessage |
| Languages | Bilingual English/Chinese communication |
| Pain frequency | Multiple times per week: searching for lost information |
| Technical comfort | Comfortable with CLI and local tools; uses OpenClaw |
| Privacy sensitivity | High — prefers local-first, no cloud dependency |

---

## 4. Product Vision

**Zero-effort knowledge indexing with layered visual exploration.**

MindFlow runs silently in the background, transforming all incoming communications and documents into an interconnected knowledge graph. Users interact with it in two ways:

- **Visual browsing**: A layered, progressively-expanding graph UI where users can drill down from high-level categories (People, Topics, Documents, Pending) into specific entities, cross-references, and original source material.
- **Natural language query**: Ask questions like "What did Wang Zong say about the budget?" and get answers with source attribution.

---

## 5. Core Features

### F1: Continuous data ingestion

The system runs as an OpenClaw cron skill, periodically scanning all configured data sources for new content.

#### Supported data sources (MVP)

| Source | Method | Scope |
|--------|--------|-------|
| Gmail | Gmail MCP or IMAP | All folders; configurable label/folder filters |
| iMessage | Local SQLite (`~/Library/Messages/chat.db`) | All conversations; optional contact exclusion list |
| Documents | Local file system watch | Configurable directories (e.g., `~/Documents`, Google Drive sync folder) |
| Meeting notes | Markdown/text files in designated folder | Auto-detect `.md`/`.txt` files with meeting-like structure |

#### Future data sources

- Slack (via Slack MCP)
- Calendar events (Google Calendar MCP)
- WeChat export (manual or via tool)
- Voice memos and transcripts

#### Ingestion behavior

- **Frequency**: Every 15 minutes (configurable). First run performs full historical scan.
- **Deduplication**: Content-hash based. Same message from email and iMessage is linked, not duplicated.
- **Incremental**: Tracks last-processed timestamp per source. Only processes new/updated items.
- **Privacy**: All processing happens locally. No data leaves the machine.

---

### F2: AI entity extraction and knowledge graph construction

Each ingested item is processed by an LLM to extract structured knowledge and build the graph.

#### Entity types

| Entity | Attributes | Example |
|--------|-----------|---------|
| Person | Name, role, organization, communication preference, relationship notes | Wang Zong — CEO, Partner Corp |
| Topic | Title, status (active/dormant), related people, first/last mention date | Q3 Budget — active since Feb 12 |
| Action Item | Description, owner, due date, status (pending/done), source | Submit revised quote by Friday |
| Key Fact | Statement, source, date, confidence, associated person/topic | Vendor B quote: $42K/yr |
| Document | Title, type, path, associated people/topics, last modified | Design spec v3.pdf |

#### Relationship types

- Person ↔ Topic (discusses, owns, stakeholder of)
- Person ↔ Person (communicates with, introduced by)
- Topic ↔ Document (related to, produced by)
- Action Item ↔ Person (assigned to, requested by)
- Message ↔ All entities (source attribution)

#### Cross-channel linking

The system identifies when the same topic or action item appears across multiple channels. For example, if Wang Zong emails about the Q3 budget and later sends an iMessage follow-up, both are linked to the same Topic node and the same Person node, creating a unified cross-channel timeline.

#### Multilingual support

Entity extraction and semantic matching must work across Chinese and English. The system uses a multilingual embedding model (e.g., `paraphrase-multilingual-MiniLM-L12-v2`) with calibrated similarity thresholds: approximately 0.50 for same-language and 0.45 for cross-lingual matching.

---

### F3: Layered visual knowledge graph

The primary user interface is a layered, progressively-expanding visual graph. Instead of showing all information at once (which causes overload), the UI presents one layer at a time, letting users drill into detail on demand.

#### Navigation model

The interface follows a center-and-ring pattern:

- **Center node**: The currently focused entity (e.g., "Me" at root, or "Wang Zong" when drilled in).
- **Ring nodes**: First-degree connections to the center node. Each ring node shows a preview (name, metadata, badge count).
- **Drill-down**: Clicking a ring node makes it the new center, revealing its own connections. A breadcrumb trail allows navigation back to any previous layer.
- **Detail panel**: Below the graph, a timeline of all source items (emails, messages, docs) related to the current center node, with channel tags and dates.

#### Layer structure

| Layer | Center | Ring shows | Example |
|-------|--------|-----------|---------|
| L0 (Root) | Me | People, Topics, Documents, Pending | 4 top-level categories |
| L1 (Category) | People | All contacts, sorted by recency | Wang Zong, Lisa Chen, Zhang San... |
| L2 (Entity) | Wang Zong | His topics + detail timeline | Q3 Budget, Vendor Selection |
| L3 (Cross-ref) | Wang Zong × Q3 Budget | Filtered timeline for this intersection | 3 emails, 1 meeting about this |

#### Visual design principles

- **Information density per layer**: Maximum 20 nodes visible at once. If a category has 50+ contacts, show top 20 by recency with a "Show all" option.
- **Badges**: Numeric badges on nodes indicate pending items or unread activity, drawing attention to what needs action.
- **Color coding**: Consistent color per entity type (purple for people, teal for topics, amber for documents, coral for pending). Source channel tags use distinct colors (blue for email, green for iMessage, purple for meetings, amber for documents).
- **Animation**: Smooth transitions when drilling in/out. New ring nodes fade in from center outward.
- **Responsive**: Works in OpenClaw's MCP Apps iframe, Telegram web view, or standalone browser.

---

### F4: Natural language query

Users can ask questions about their knowledge base in natural language, in either English or Chinese.

#### Query types

| Type | Example | System behavior |
|------|---------|----------------|
| Factual recall | What was the Vendor B quote? | Search key facts, return answer + source |
| Person context | What have I discussed with Lisa recently? | Retrieve person timeline, summarize |
| Cross-reference | Who mentioned the Q3 deadline? | Search across all people/channels for topic |
| Pending items | What am I forgetting? | List all pending action items, sorted by urgency |
| Relationship | How do I know Zhang San? | Trace relationship history from first interaction |

#### Response format

- **Answer first**: Direct answer to the question.
- **Source attribution**: Each claim links back to the original message/document with channel, sender, and date.
- **Visual link**: Option to "View in graph" to jump to the relevant node in the layered visualization.

---

### F5: Proactive attention surface

The "Pending" category in the graph is not a static list — it is an AI-driven attention system that proactively identifies items the user may have forgotten.

#### Detection rules

- **Unanswered requests**: Someone asked you a question or made a request, and you haven't responded within a configurable window (default: 48 hours).
- **Approaching deadlines**: Action items with dates approaching or past due.
- **Unreviewed documents**: A shared document was sent to you and you haven't opened the corresponding file.
- **Stale conversations**: An active topic hasn't had any activity in 7+ days, suggesting it may need follow-up.
- **Repeated mentions**: The same person or topic is mentioned across multiple channels in a short period, suggesting urgency.

---

## 6. System Architecture

### 6.1 High-level components

| Component | Technology | Responsibility |
|-----------|-----------|---------------|
| Ingestion layer | OpenClaw cron skills (one per source) | Periodically fetch new messages, emails, documents |
| Processing pipeline | LLM (Claude/GPT) via API | Entity extraction, relationship detection, intent classification |
| Knowledge store | SQLite + JSON (local) | Entity storage, relationship edges, full-text index |
| Embedding index | Transformers.js + FAISS/SQLite FTS5 | Semantic search across all indexed content |
| Visualization server | Local HTTP server (MCP Apps) | Serve layered graph UI as interactive HTML |
| Query interface | OpenClaw tool (graphiti_search pattern) | NL query → graph traversal → LLM answer |

### 6.2 Data flow

1. **Ingest**: Cron skill triggers every 15 min. Each source adapter fetches new items since last checkpoint. Raw content stored in local SQLite.
2. **Process**: New items queued for LLM processing. Batch API call extracts entities (people, topics, action items, key facts) and relationships. Results written to knowledge graph tables.
3. **Embed**: Processed content embedded using multilingual model. Vectors stored for semantic search.
4. **Link**: Deduplication and cross-channel linking. Same person/topic across email and iMessage merged. Confidence scores assigned to relationships.
5. **Surface**: Pending item detector runs. Attention scores updated. Visual graph regenerated.

### 6.3 Database schema (core tables)

| Table | Key columns | Purpose |
|-------|------------|---------|
| `raw_items` | id, source, channel, sender, recipients, content, timestamp, hash | Original messages/documents |
| `entities` | id, type (person\|topic\|action\|fact\|doc), name, attributes_json, created, updated | Extracted entities |
| `relationships` | id, from_entity, to_entity, type, strength, source_item, timestamp | Entity connections |
| `embeddings` | entity_id, vector_blob, model_version | Semantic search vectors |
| `attention` | id, entity_id, type, urgency_score, detected_at, resolved_at | Pending/proactive items |
| `sync_state` | source, last_checkpoint, items_count | Ingestion tracking |

---

## 7. Technical Requirements

### 7.1 Performance

- **Initial full index**: Process 10,000 historical emails + 50,000 iMessages within 4 hours (background, non-blocking).
- **Incremental update**: Process 100 new items within 60 seconds.
- **Query response**: Semantic search returns results within 500ms. LLM-powered answers within 5 seconds.
- **Graph render**: Layer transition animation completes within 300ms. Initial load under 1 second.

### 7.2 Storage

- **Estimated size**: ~500MB for 100K indexed items (raw + entities + embeddings). Grows ~50MB/month for active users.
- **Location**: `~/.openclaw/mindflow/` (follows OpenClaw conventions).

### 7.3 Privacy and security

- **Local-first**: All data stored locally. No cloud sync or external telemetry.
- **LLM calls**: Entity extraction requires API calls to LLM provider. Only message content is sent; no metadata, file paths, or user identity.
- **Exclusion list**: Users can exclude specific contacts, email labels, or iMessage conversations from indexing.
- **Encryption**: SQLite database encrypted at rest (SQLCipher) with user-provided passphrase.

### 7.4 Platform requirements

- **OS**: macOS 13+ (required for iMessage database access).
- **Runtime**: Node.js 20+ (OpenClaw runtime).
- **Dependencies**: SQLite3, Transformers.js (for local embeddings), OpenClaw SDK.

---

## 8. User Experience Specification

### 8.1 Installation and setup

Single command installation via OpenClaw plugin system:

```
openclaw plugins install @mindflow/mindflow
```

First-run wizard (CLI-based):

1. Configure email source (Gmail OAuth or IMAP credentials)
2. Grant Full Disk Access for iMessage database reading
3. Set document watch directories
4. Configure exclusion list (optional)
5. Set LLM provider API key (Claude or GPT)
6. Choose initial scan depth (last 30 days / 6 months / 1 year / all time)

### 8.2 Daily usage flow

**Morning**: User opens MindFlow graph (via OpenClaw command or Telegram). Sees the root layer with badge counts on "Pending" (3 items need attention). Drills into Pending, sees "Wang Zong waiting for budget update" — clicks through to full context.

**Ad-hoc query**: User asks OpenClaw: "Lisa上次发的那个设计文档叫什么" (What was the design doc Lisa sent?). System returns: "Design spec v3, shared via email yesterday at 5:20 PM" with link to original.

**Before a meeting**: User drills into a contact's node to review all recent communication context before a call. Sees cross-channel timeline, key facts, and pending items in one view.

**Weekly review**: User browses the Topics layer to see which topics have gone quiet (stale conversations) and which have been most active. Discovers a forgotten thread about contract renewal.

### 8.3 Query entry points

| Entry point | Method | Priority |
|------------|--------|----------|
| OpenClaw CLI | `/mindflow` or natural language question | MVP |
| MCP Apps visual graph | Browser-based layered graph UI | MVP |
| Telegram bot | Text query or `/mindflow` command | V1.1 |
| Spotlight-like shortcut | Global hotkey opens search overlay | V1.2 |

---

## 9. Knowledge Graph Design

### 9.1 Design principles

- **Person-centric**: People are the primary navigation anchor. Users think "Who told me?" before "What was the topic?"
- **Time-aware**: All edges carry timestamps. Recency affects ranking and display order. Stale relationships fade visually.
- **Multi-entry**: The same graph can be entered from any entity type — person, topic, document, or pending item.
- **Invisible to user**: Users never see "nodes" or "edges." They see people, topics, and timelines. The graph is the engine, not the interface.
- **Progressive disclosure**: Each layer shows only first-degree connections. Full complexity is available but never forced on the user.

### 9.2 Entity resolution strategy

The same person may appear as "Wang Zong" in email, "王总" in iMessage, and "wang.zong@partner.com" in CC fields. Entity resolution combines:

- **Email address matching**: Primary key for person identification.
- **Phone number matching**: iMessage sender ID cross-referenced with Contacts.app.
- **Name similarity**: Multilingual fuzzy matching (Chinese name ↔ English name ↔ Pinyin).
- **LLM-assisted merge**: When automated matching is uncertain, batch LLM calls to resolve ambiguous entities with context.

### 9.3 Topic clustering

Topics are not manually created. They emerge from message content through:

- **Semantic clustering**: Messages with similar embedding vectors are grouped into topics.
- **Temporal proximity**: Messages in the same thread or close in time are more likely to belong to the same topic.
- **LLM labeling**: The LLM generates a human-readable topic name (e.g., "Q3 Budget") and updates it as the topic evolves.
- **Topic lifecycle**: Topics auto-transition from "active" to "dormant" after 14 days of inactivity, and from "dormant" to "archived" after 60 days.

---

## 10. MVP Scope and Phasing

### Phase 1: MVP (Weeks 1–6)

| Feature | Scope | Success metric |
|---------|-------|---------------|
| Gmail ingestion | Full history + incremental sync via IMAP | 100% of emails indexed |
| iMessage ingestion | Read local chat.db, process all conversations | 95%+ conversations captured |
| Entity extraction | People, topics, action items from messages | 85%+ precision on entity extraction |
| Knowledge graph store | SQLite with FTS5 + embedding index | Sub-500ms query response |
| Layered visual graph | 4-layer drilldown (root → category → entity → cross-ref) | Functional in browser |
| NL query (basic) | Simple factual queries via OpenClaw tool | Answers 70%+ of test queries correctly |
| Pending detection | Unanswered requests and overdue items | Surfaces 80%+ of actual pending items |

### Phase 2: V1.1 (Weeks 7–10)

- Document ingestion (local file system watch)
- Meeting notes parsing (structured Markdown)
- Telegram bot as query/notification interface
- Improved topic clustering with user feedback loop
- Weekly digest generation (automatic summary of the week)

### Phase 3: V1.2 (Weeks 11–16)

- Slack integration via MCP
- Calendar event context (pre-meeting briefs)
- Global search overlay (Spotlight-like hotkey)
- Multi-machine sync (encrypted, between user's own devices)
- Shared knowledge spaces (opt-in, for team use)

---

## 11. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Index coverage | >95% of all communications indexed | Compare raw item count vs. source count |
| Entity precision | >85% correct entity extraction | Manual audit of 200 random samples |
| Query accuracy | >70% useful answers on first try | User satisfaction on query responses |
| Pending recall | >80% of actual pending items surfaced | Compare detected vs. user-reported items |
| Daily active usage | User opens graph or queries 3+ times/day | Usage logging (local only) |
| Time to find | <30 seconds to locate any past communication | User testing with timed tasks |
| Information recovery | Recover 5+ forgotten items per week | User self-report via feedback |

---

## 12. Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| iMessage DB schema changes in macOS updates | High | Abstract DB access layer; version detection; community monitoring |
| LLM API costs for processing large message volumes | Medium | Batch processing; local model fallback for simple extraction; smart throttling |
| Entity resolution errors (wrong person merge) | Medium | Conservative auto-merge thresholds; manual override UI; undo capability |
| Full Disk Access permission friction | Medium | Clear setup wizard; explain privacy model; show what data is accessed |
| Privacy concerns with LLM API calls | High | Minimize sent context; strip metadata; option for local-only model (Ollama) |
| Graph becomes too large over time | Low | Automatic archiving of dormant entities; configurable retention policy |
| Multilingual entity matching errors | Medium | Calibrated thresholds per language pair; user correction feedback loop |

---

## 13. Competitive Landscape

| Product | Approach | Gap MindFlow fills |
|---------|----------|-------------------|
| Recall (getrecall.ai) | Web content → knowledge graph | No email/iMessage ingestion; no local-first; no proactive attention |
| Rewind / Limitless | Full screen recording → searchable archive | Privacy-invasive; no entity extraction; no structured graph |
| Cognee (OpenClaw plugin) | Indexes agent's own memory files | Only agent memory, not user's external communications |
| Graphiti (OpenClaw plugin) | Knowledge graph from agent conversations | Same: agent-centric, not user-centric |
| Heptabase | Visual whiteboard for manual note organization | Requires manual input; no automated ingestion |
| Tana | Structured supertag-based PKM | Powerful but manual; no email/iMessage; steep learning curve |
| Capacities | Object-based notes with entity types | Manual entry; no automated cross-channel linking |

**MindFlow's unique position**: It is the only solution that combines (1) automated ingestion from personal communications, (2) AI-powered entity extraction and cross-channel linking, (3) layered visual exploration, and (4) local-first privacy — all integrated into the OpenClaw agent ecosystem.

---

## 14. Open Questions

1. **Graph layout algorithm**: Should the layered graph use a radial/star layout (center node with spokes) or the card-based layout from the prototype? Need user testing.
2. **LLM provider default**: Claude Sonnet (better Chinese) vs. GPT (faster, cheaper for extraction)? Or configurable with sensible default?
3. **Notification channel**: Should proactive pending alerts push to Telegram, or only appear when user opens the graph?
4. **Team/shared mode**: If two users both run MindFlow and communicate with each other, can their graphs interlink? What are the privacy implications?
5. **Offline LLM**: Should we support Ollama for fully offline entity extraction in MVP, or defer to V1.1?
6. **iMessage attachment handling**: Should we extract text from images/PDFs sent via iMessage, or just index the message text?

---

## Appendix A: User Story Examples

- **US-1**: As a user, I want to find the price that Wang Zong quoted me last month, so I don't have to search through 200 emails.
- **US-2**: As a user, I want to see everything I've discussed with Lisa in one place, across email and iMessage, so I can prepare for our 1:1.
- **US-3**: As a user, I want to be reminded that Zhang San is waiting for my reply on the contract, because I completely forgot about it.
- **US-4**: As a user, I want to visually explore all active topics and see which ones have gone quiet, so I can decide what needs follow-up.
- **US-5**: As a user, I want to ask "谁提过这个项目" (Who mentioned this project?) and get a clear answer with sources, regardless of whether they mentioned it in Chinese or English.

---

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| Entity | A structured knowledge object extracted from raw communications: Person, Topic, Action Item, Key Fact, or Document |
| Cross-channel linking | Connecting the same entity or event across different communication channels (email + iMessage + docs) |
| Progressive disclosure | UI pattern where information is revealed layer by layer, reducing cognitive load |
| Attention surface | The system's proactive layer that identifies items the user may have forgotten or needs to act on |
| Entity resolution | The process of determining that two references (e.g., "Wang Zong" and "王总") refer to the same real-world entity |
| Knowledge graph | A structured representation of entities and their relationships, stored as nodes and edges |
| MCP Apps | OpenClaw's framework for rendering rich UI elements in sandboxed iframes via the `ui://` scheme |
