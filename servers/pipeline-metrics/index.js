#!/usr/bin/env node
/**
 * Pipeline Metrics MCP Server
 *
 * Provides tools for recording and querying pipeline execution metrics.
 * Uses SQLite for local storage.
 *
 * Tools:
 *   metrics_record  — Record a pipeline event
 *   metrics_query   — Query events with filters
 *   metrics_summary — Summarize metrics for a run
 *   metrics_export  — Export metrics as JSON
 *
 * Event types:
 *   task_start, task_end, review_round, quality_gate,
 *   model_switch, circuit_breaker, run_start, run_end
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { mkdirSync } from "fs";

const DB_PATH = process.env.METRICS_DB || resolve("metrics.db");

// Ensure parent directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

// Initialize database
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.prepare(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    run_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    task_id TEXT,
    data TEXT DEFAULT '{}',
    duration_ms INTEGER
  )
`).run();
db.prepare(
  "CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id)"
).run();
db.prepare(
  "CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)"
).run();

const VALID_EVENT_TYPES = [
  "task_start",
  "task_end",
  "review_round",
  "quality_gate",
  "model_switch",
  "circuit_breaker",
  "run_start",
  "run_end",
];

// Tool definitions
const TOOLS = [
  {
    name: "metrics_record",
    description: "Record a pipeline execution event",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string", description: "Pipeline run ID" },
        event_type: {
          type: "string",
          enum: VALID_EVENT_TYPES,
          description: "Type of event",
        },
        task_id: {
          type: "string",
          description: "Task ID (optional)",
        },
        data: {
          type: "object",
          description: "Additional event data",
        },
        duration_ms: {
          type: "number",
          description: "Duration in milliseconds (optional)",
        },
      },
      required: ["run_id", "event_type"],
    },
  },
  {
    name: "metrics_query",
    description: "Query pipeline events with filters",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string", description: "Filter by run ID" },
        event_type: { type: "string", description: "Filter by event type" },
        task_id: { type: "string", description: "Filter by task ID" },
        limit: {
          type: "number",
          description: "Max results (default 100)",
          default: 100,
        },
      },
    },
  },
  {
    name: "metrics_summary",
    description: "Get a summary of metrics for a pipeline run",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string", description: "Pipeline run ID" },
      },
      required: ["run_id"],
    },
  },
  {
    name: "metrics_export",
    description: "Export all metrics for a run as JSON",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string", description: "Pipeline run ID" },
      },
      required: ["run_id"],
    },
  },
];

// Handlers
function handleRecord({ run_id, event_type, task_id, data, duration_ms }) {
  if (!VALID_EVENT_TYPES.includes(event_type)) {
    return { error: `Invalid event type: ${event_type}` };
  }
  const stmt = db.prepare(
    "INSERT INTO events (run_id, event_type, task_id, data, duration_ms) VALUES (?, ?, ?, ?, ?)"
  );
  const result = stmt.run(
    run_id,
    event_type,
    task_id || null,
    JSON.stringify(data || {}),
    duration_ms || null
  );
  return { id: result.lastInsertRowid, recorded: true };
}

function handleQuery({ run_id, event_type, task_id, limit = 100 }) {
  let sql = "SELECT * FROM events WHERE 1=1";
  const params = [];
  if (run_id) {
    sql += " AND run_id = ?";
    params.push(run_id);
  }
  if (event_type) {
    sql += " AND event_type = ?";
    params.push(event_type);
  }
  if (task_id) {
    sql += " AND task_id = ?";
    params.push(task_id);
  }
  sql += " ORDER BY timestamp DESC LIMIT ?";
  params.push(Math.min(limit, 1000));
  return db.prepare(sql).all(...params);
}

function handleSummary({ run_id }) {
  const events = db
    .prepare("SELECT * FROM events WHERE run_id = ? ORDER BY timestamp")
    .all(run_id);

  if (events.length === 0) {
    return { run_id, error: "No events found" };
  }

  const summary = {
    run_id,
    total_events: events.length,
    event_counts: {},
    tasks: {},
    total_duration_ms: 0,
    review_rounds: 0,
    quality_gates: { passed: 0, failed: 0 },
  };

  for (const event of events) {
    summary.event_counts[event.event_type] =
      (summary.event_counts[event.event_type] || 0) + 1;

    if (event.duration_ms) {
      summary.total_duration_ms += event.duration_ms;
    }

    if (event.task_id) {
      if (!summary.tasks[event.task_id]) {
        summary.tasks[event.task_id] = { events: 0 };
      }
      summary.tasks[event.task_id].events++;
    }

    if (event.event_type === "review_round") {
      summary.review_rounds++;
    }

    if (event.event_type === "quality_gate") {
      let data = {};
      try { data = JSON.parse(event.data || "{}"); } catch {}
      if (data.passed) {
        summary.quality_gates.passed++;
      } else {
        summary.quality_gates.failed++;
      }
    }
  }

  return summary;
}

function handleExport({ run_id }) {
  return db
    .prepare("SELECT * FROM events WHERE run_id = ? ORDER BY timestamp")
    .all(run_id)
    .map((row) => {
      let data = {};
      try { data = JSON.parse(row.data || "{}"); } catch {}
      return { ...row, data };
    });
}

// Server setup
const server = new Server(
  { name: "pipeline-metrics", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  let result;
  switch (name) {
    case "metrics_record":
      result = handleRecord(args);
      break;
    case "metrics_query":
      result = handleQuery(args);
      break;
    case "metrics_summary":
      result = handleSummary(args);
      break;
    case "metrics_export":
      result = handleExport(args);
      break;
    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
