---
name: mindflow-setup
description: "Configure MindFlow data sources, LLM provider, and privacy settings"
metadata:
  openclaw:
    emoji: "🧠"
    requires:
      config:
        - plugins.entries.mindflow
---

# MindFlow Setup

Use this skill when the user wants to configure MindFlow for the first time,
add a new data source, or change their LLM provider settings.

## Steps

1. Check if MindFlow server is running. If not, start it via the mindflow_search tool (which auto-starts the server).
2. Check current configuration status via GET /api/stats.
3. **LLM provider auto-detection**: Check if OpenClaw already has Anthropic credentials configured. If yes, skip LLM setup and tell the user "Using your existing Claude credentials from OpenClaw." If not, ask for a Claude API key, OpenAI key, or suggest Ollama for fully local operation.
4. Walk the user through data source configuration:
   - Email source (Gmail IMAP): host, port, user, password
   - iMessage access (macOS only): verify Full Disk Access
   - Document directories: paths to watch
   - Privacy mode: Full Local / Content-Aware (default) / Minimal Cloud
   - Initial scan depth: 30 days / 6 months / 1 year / all
5. Save configuration via POST /api/config.
6. Trigger initial ingestion via POST /api/ingest.
7. Tell the user the Web UI URL: "Open http://127.0.0.1:{port} in your browser to explore your knowledge graph visually."
8. Report status and next steps.

## Important

- Store IMAP passwords and API keys via the MindFlow API, NOT in openclaw.json.
- The server must be running before configuration can be saved.
- Use the mindflow_digest tool after setup to verify everything works.
- For LLM credentials, always try auto-detecting OpenClaw's existing Anthropic provider first.

## Tool Usage (after setup)

Once configured, use these tools naturally in conversation:
- `mindflow_search` — for any knowledge query
- `mindflow_entity` — to look up a person or topic before a meeting
- `mindflow_pending` — to check what needs attention
- `mindflow_digest` — for a summary of recent activity
- `mindflow_dashboard` — get the Web UI URL to explore the knowledge graph visually
