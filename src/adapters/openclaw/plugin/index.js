/**
 * MindFlow OpenClaw Plugin
 *
 * Registers:
 *   - Five MCP tools: mindflow_search, mindflow_entity, mindflow_pending,
 *     mindflow_digest, mindflow_dashboard
 *   - A message hook that triggers real-time ingestion of Telegram/Slack messages
 *
 * The ServiceManager auto-starts the MindFlow HTTP server on the first tool call.
 * Default port: 3456 (configurable via plugins.entries.mindflow.config.port).
 *
 * Install:
 *   openclaw plugins install --link ./src/adapters/openclaw/plugin
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import { ServiceManager } from "./service-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildServiceManager(api) {
  const cfg = api.pluginConfig ?? {};
  return new ServiceManager({
    port: typeof cfg.port === "number" ? cfg.port : undefined,
    dataDir: typeof cfg.dataDir === "string" ? cfg.dataDir : undefined,
    autoStart: typeof cfg.autoStart === "boolean" ? cfg.autoStart : true,
  });
}

async function apiCall(baseUrl, path, init) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let msg = `MindFlow API error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = String(body.error);
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return res.json();
}

function formatAttentionItem(item) {
  const urgency = item.urgencyScore >= 0.7 ? "HIGH" : item.urgencyScore >= 0.4 ? "MEDIUM" : "LOW";
  const age = formatAge(item.detectedAt);
  return `[${urgency}] ${item.title}${item.description ? `\n  ${item.description}` : ""}\n  Detected: ${age}`;
}

function formatAge(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function textPayload(text) {
  return [{ type: "text", text, isError: false }];
}

function notConfiguredError() {
  return {
    payloads: textPayload(
      "MindFlow is not configured yet. Run the setup wizard: /mindflow-setup"
    ),
  };
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export default definePluginEntry({
  id: "mindflow",
  name: "MindFlow",
  description:
    "Personal knowledge graph tools. Search emails, messages, and documents; look up people and topics; surface pending items and generate daily digests.",

  configSchema: {
    validate(value) {
      if (value === null || value === undefined || typeof value === "object") {
        return { ok: true };
      }
      return { ok: false, errors: ["mindflow plugin config must be an object"] };
    },
  },

  register(api) {
    const serviceManager = buildServiceManager(api);

    // Graceful shutdown: stop the child process when the gateway exits.
    for (const sig of ["SIGINT", "SIGTERM"]) {
      process.on(sig, () => {
        serviceManager.stop(); // synchronous-safe — sends SIGTERM internally
      });
    }

    // -----------------------------------------------------------------------
    // mindflow_search — natural language query
    // -----------------------------------------------------------------------
    api.registerTool({
      name: "mindflow_search",
      description:
        "Search your personal knowledge graph by natural language query. Returns an AI-synthesized answer with source attribution from emails, messages, and documents.",
      parameters: Type.Object({
        query: Type.String({ description: "Natural language query, e.g. 'What did Wang Zong say about the Q3 budget?'" }),
      }),
      async execute(_id, params) {
        let baseUrl;
        try {
          baseUrl = await serviceManager.ensureRunning();
        } catch (err) {
          if (String(err).includes("not configured")) return notConfiguredError();
          throw err;
        }

        const query = typeof params.query === "string" ? params.query.trim() : "";
        if (!query) throw new Error("query is required");

        const result = await apiCall(baseUrl, "/query", {
          method: "POST",
          body: JSON.stringify({ query }),
        });

        const lines = [];
        if (result.answer) {
          lines.push(result.answer);
        } else {
          lines.push("No synthesized answer available.");
        }

        if (Array.isArray(result.entities) && result.entities.length > 0) {
          lines.push("\nRelated entities:");
          for (const e of result.entities.slice(0, 5)) {
            lines.push(`  • ${e.canonicalName} (${e.type})`);
          }
        }

        if (Array.isArray(result.items) && result.items.length > 0) {
          lines.push(`\nSource items: ${result.items.length}`);
          for (const item of result.items.slice(0, 3)) {
            const preview = (item.body ?? "").slice(0, 120).replace(/\n/g, " ");
            lines.push(`  [${item.channel}] ${item.subject ?? "(no subject)"}: ${preview}…`);
          }
        }

        if (typeof result.confidence === "number") {
          lines.push(`\nConfidence: ${Math.round(result.confidence * 100)}%`);
        }

        return { payloads: textPayload(lines.join("\n")), details: result };
      },
    });

    // -----------------------------------------------------------------------
    // mindflow_entity — look up an entity by name
    // -----------------------------------------------------------------------
    api.registerTool({
      name: "mindflow_entity",
      description:
        "Look up a person, topic, or document in your knowledge graph by name. Returns relationships, timeline summary, and key facts.",
      parameters: Type.Object({
        name: Type.String({ description: "Entity name to look up, e.g. 'Wang Zong' or 'Q3 Budget'" }),
      }),
      async execute(_id, params) {
        let baseUrl;
        try {
          baseUrl = await serviceManager.ensureRunning();
        } catch (err) {
          if (String(err).includes("not configured")) return notConfiguredError();
          throw err;
        }

        const name = typeof params.name === "string" ? params.name.trim() : "";
        if (!name) throw new Error("name is required");

        // Search via query to find matching entities
        const queryResult = await apiCall(baseUrl, "/query", {
          method: "POST",
          body: JSON.stringify({ query: `Tell me about ${name}` }),
        });

        const entities = Array.isArray(queryResult.entities) ? queryResult.entities : [];
        const match =
          entities.find(
            (e) =>
              e.canonicalName?.toLowerCase() === name.toLowerCase() ||
              e.nameAlt?.toLowerCase() === name.toLowerCase() ||
              (Array.isArray(e.aliases) && e.aliases.some((a) => a.toLowerCase() === name.toLowerCase()))
          ) ?? entities[0];

        if (!match) {
          return {
            payloads: textPayload(`No entity found matching "${name}".`),
            details: null,
          };
        }

        // Fetch entity detail + timeline
        const [detail, timelinePage] = await Promise.all([
          apiCall(baseUrl, `/entities/${match.id}`),
          apiCall(baseUrl, `/entities/${match.id}/timeline?limit=5`),
        ]);

        const lines = [];
        const entity = detail.entity ?? match;
        const stats = detail.stats;

        lines.push(`${entity.canonicalName} (${entity.type})`);
        if (entity.nameAlt) lines.push(`Also known as: ${entity.nameAlt}`);
        lines.push(`Status: ${entity.status}`);

        if (stats) {
          lines.push(`Messages: ${stats.messageCount ?? 0}, Relationships: ${stats.relationshipCount ?? 0}`);
          if (stats.lastSeenAt) lines.push(`Last seen: ${formatAge(stats.lastSeenAt)}`);
        }

        const items = timelinePage?.items ?? [];
        if (items.length > 0) {
          lines.push("\nRecent activity:");
          for (const item of items) {
            const preview = (item.body ?? "").slice(0, 100).replace(/\n/g, " ");
            lines.push(`  [${item.channel}] ${item.subject ?? "(no subject)"}: ${preview}…`);
          }
        }

        return { payloads: textPayload(lines.join("\n")), details: detail };
      },
    });

    // -----------------------------------------------------------------------
    // mindflow_pending — items needing attention
    // -----------------------------------------------------------------------
    api.registerTool({
      name: "mindflow_pending",
      description:
        "Show items that need your attention: unanswered requests, approaching deadlines, stale conversations, and unreviewed documents.",
      parameters: Type.Object({}),
      async execute(_id, _params) {
        let baseUrl;
        try {
          baseUrl = await serviceManager.ensureRunning();
        } catch (err) {
          if (String(err).includes("not configured")) return notConfiguredError();
          throw err;
        }

        const result = await apiCall(baseUrl, "/attention");
        const items = Array.isArray(result.items) ? result.items : [];

        if (items.length === 0) {
          return {
            payloads: textPayload("Nothing needs your attention right now."),
            details: result,
          };
        }

        // Sort by urgency score descending
        const sorted = [...items].sort((a, b) => b.urgencyScore - a.urgencyScore);
        const lines = [`${sorted.length} item(s) need your attention:\n`];
        for (const item of sorted) {
          lines.push(formatAttentionItem(item));
        }

        return { payloads: textPayload(lines.join("\n")), details: result };
      },
    });

    // -----------------------------------------------------------------------
    // mindflow_digest — daily knowledge digest
    // -----------------------------------------------------------------------
    api.registerTool({
      name: "mindflow_digest",
      description:
        "Generate a daily knowledge digest: system stats, pending attention items, recently active people, and active topics.",
      parameters: Type.Object({}),
      async execute(_id, _params) {
        let baseUrl;
        try {
          baseUrl = await serviceManager.ensureRunning();
        } catch (err) {
          if (String(err).includes("not configured")) return notConfiguredError();
          throw err;
        }

        const [statsResult, attentionResult, peopleResult, topicsResult] = await Promise.all([
          apiCall(baseUrl, "/stats"),
          apiCall(baseUrl, "/attention"),
          apiCall(baseUrl, "/entities?type=person&limit=5&sort=recent"),
          apiCall(baseUrl, "/entities?type=topic&limit=5&sort=recent"),
        ]);

        const lines = [];

        // Stats
        lines.push("## MindFlow Daily Digest\n");
        lines.push(
          `Knowledge base: ${statsResult.entityCount ?? 0} entities, ${statsResult.rawItemCount ?? 0} indexed items`
        );
        if (statsResult.lastSyncAt) {
          lines.push(`Last sync: ${formatAge(statsResult.lastSyncAt)}`);
        }

        // Attention
        const attentionItems = Array.isArray(attentionResult.items) ? attentionResult.items : [];
        lines.push(`\n### Attention (${attentionItems.length})`);
        if (attentionItems.length === 0) {
          lines.push("All clear.");
        } else {
          const sorted = [...attentionItems].sort((a, b) => b.urgencyScore - a.urgencyScore);
          for (const item of sorted.slice(0, 5)) {
            lines.push(formatAttentionItem(item));
          }
          if (sorted.length > 5) lines.push(`  …and ${sorted.length - 5} more.`);
        }

        // Recent people
        const people = Array.isArray(peopleResult.entities) ? peopleResult.entities : [];
        if (people.length > 0) {
          lines.push("\n### Recent Contacts");
          for (const p of people) {
            lines.push(`  • ${p.canonicalName} — last seen ${formatAge(p.lastSeenAt)}`);
          }
        }

        // Active topics
        const topics = Array.isArray(topicsResult.entities) ? topicsResult.entities : [];
        if (topics.length > 0) {
          lines.push("\n### Active Topics");
          for (const t of topics) {
            lines.push(`  • ${t.canonicalName} (${t.status}) — last: ${formatAge(t.lastSeenAt)}`);
          }
        }

        // Dashboard footer (per design doc Section 3.3)
        lines.push(`\nDashboard: ${baseUrl}`);

        return {
          payloads: textPayload(lines.join("\n")),
          details: { stats: statsResult, attention: attentionResult, people: peopleResult, topics: topicsResult },
        };
      },
    });

    // -----------------------------------------------------------------------
    // mindflow_dashboard — returns the web UI URL
    // -----------------------------------------------------------------------
    api.registerTool({
      name: "mindflow_dashboard",
      description:
        "Get the MindFlow web dashboard URL for visual knowledge graph exploration.",
      parameters: Type.Object({}),
      async execute(_id, _params) {
        let baseUrl;
        try {
          baseUrl = await serviceManager.ensureRunning();
        } catch (err) {
          if (String(err).includes("not configured")) return notConfiguredError();
          throw err;
        }

        return {
          payloads: textPayload(
            `MindFlow dashboard: ${baseUrl}\n\nOpen this URL in your browser to explore your knowledge graph visually.`
          ),
        };
      },
    });

    // -----------------------------------------------------------------------
    // Message hook — real-time ingestion for streaming channels
    // (Telegram, Slack, Discord messages captured as they arrive)
    // Batch sources (Gmail IMAP, iMessage, filesystem) use the cron job instead.
    // -----------------------------------------------------------------------
    api.registerHook(
      ["message:received", "message:sent"],
      async (_event) => {
        // Use the active port if the service is already running; skip startup cost.
        const pid = serviceManager.getPid();
        if (pid === null && !(await serviceManager.healthCheck())) {
          // Server not running — skip silently rather than triggering a startup on every message.
          return;
        }

        let baseUrl;
        try {
          baseUrl = await serviceManager.ensureRunning();
        } catch {
          return; // Fail silently — don't interrupt messaging
        }

        try {
          await fetch(`${baseUrl}/api/ingest`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(3000),
          });
        } catch {
          // Server not running or timeout — fail silently
        }
      },
      { name: "mindflow-ingest", description: "Trigger MindFlow ingestion on incoming/outgoing messages" },
    );
  },
});
