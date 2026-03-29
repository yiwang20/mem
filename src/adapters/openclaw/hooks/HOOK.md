---
name: mindflow-ingest
description: "Trigger MindFlow ingestion when messages are received or sent"
metadata:
  openclaw:
    emoji: "📥"
    events: ["message:received", "message:sent"]
    requires:
      config:
        - plugins.entries.mindflow
---

# MindFlow Ingestion Hook

Triggers a lightweight ingestion cycle in the MindFlow server whenever a message
is received or sent through any OpenClaw channel (Telegram, WhatsApp, etc.).

This captures real-time messaging data into the knowledge graph without waiting
for the next scheduled ingestion cycle.
