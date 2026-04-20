#!/usr/bin/env node
/**
 * Pipeline Metrics MCP Server (zero-dependency)
 *
 * Hand-rolled MCP stdio JSON-RPC 2.0. JSONL storage.
 *
 * Tools:
 *   metrics_record  — Record a pipeline event
 *   metrics_query   — Query events with filters
 *   metrics_summary — Summarize metrics for a run
 *   metrics_export  — Export metrics as JSON
 *
 * Event types:
 *   task_start, task_end, review_round, quality_gate,
 *   circuit_breaker, run_start, run_end
 *
 * Storage: appends one JSON object per line to METRICS_DB (default:
 * ./metrics.jsonl). Append-only, O(n) query. Volume is expected to
 * stay in the low thousands per run; acceptable.
 *
 * Runs with zero install: no node_modules required. Requires Node 18+.
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const STORE = process.env.METRICS_DB || resolve("metrics.jsonl");
mkdirSync(dirname(STORE), { recursive: true });

const VALID_EVENT_TYPES = [
  "task_start",
  "task_end",
  "review_round",
  "quality_gate",
  "circuit_breaker",
  "run_start",
  "run_end",
];

class HandlerInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "HandlerInputError";
  }
}

function _requireString(args, key) {
  const v = args?.[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new HandlerInputError(
      `missing or invalid required field: ${key} (expected non-empty string)`,
    );
  }
  return v;
}

function _parseStoredData(raw) {
  if (raw === null || raw === undefined || raw === "") {
    return { data: {}, parse_error: null };
  }
  if (typeof raw === "object") {
    return { data: raw, parse_error: null };
  }
  try {
    return { data: JSON.parse(raw), parse_error: null };
  } catch (err) {
    return { data: {}, parse_error: err.message };
  }
}

// Append-only log. `id` derived from line count at startup; each append
// increments. Good enough for a single-process server.
let nextId = 1;
if (existsSync(STORE)) {
  try {
    const raw = readFileSync(STORE, "utf8");
    const lines =
      raw.length === 0 ? 0 : raw.split("\n").filter((l) => l.length > 0).length;
    nextId = lines + 1;
  } catch {
    // Corrupt / unreadable: start fresh counter. Existing content stays.
    nextId = 1;
  }
}

function readAllEvents() {
  if (!existsSync(STORE)) return [];
  const raw = readFileSync(STORE, "utf8");
  const out = [];
  const lines = raw.split("\n");
  for (const line of lines) {
    if (line.length === 0) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // Skip malformed lines. _parseStoredData on event.data still flags
      // corrupt nested payloads at summary time.
    }
  }
  return out;
}

function appendEvent(row) {
  appendFileSync(STORE, JSON.stringify(row) + "\n");
}

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
        task_id: { type: "string", description: "Task ID (optional)" },
        data: { type: "object", description: "Additional event data" },
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
        offset: {
          type: "number",
          description: "Offset for pagination (default 0)",
          default: 0,
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

function handleRecord(args) {
  const run_id = _requireString(args, "run_id");
  const event_type = _requireString(args, "event_type");
  if (!VALID_EVENT_TYPES.includes(event_type)) {
    throw new HandlerInputError(
      `invalid event_type: ${event_type} (expected one of ${VALID_EVENT_TYPES.join(", ")})`,
    );
  }
  const { task_id, data, duration_ms } = args;
  if (
    task_id !== undefined &&
    task_id !== null &&
    typeof task_id !== "string"
  ) {
    throw new HandlerInputError("task_id must be a string when present");
  }
  if (
    data !== undefined &&
    data !== null &&
    (typeof data !== "object" || Array.isArray(data))
  ) {
    throw new HandlerInputError("data must be an object when present");
  }
  if (
    duration_ms !== undefined &&
    duration_ms !== null &&
    (typeof duration_ms !== "number" || !Number.isFinite(duration_ms))
  ) {
    throw new HandlerInputError(
      "duration_ms must be a finite number when present",
    );
  }

  const row = {
    id: nextId++,
    timestamp: new Date().toISOString(),
    run_id,
    event_type,
    task_id: task_id || null,
    data: data || {},
    duration_ms: duration_ms == null ? null : duration_ms,
  };
  appendEvent(row);
  return { id: row.id, recorded: true };
}

function handleQuery(args) {
  const { run_id, event_type, task_id, limit = 100, offset = 0 } = args || {};
  if (run_id !== undefined && typeof run_id !== "string") {
    throw new HandlerInputError("run_id must be a string when present");
  }
  if (event_type !== undefined && typeof event_type !== "string") {
    throw new HandlerInputError("event_type must be a string when present");
  }
  if (task_id !== undefined && typeof task_id !== "string") {
    throw new HandlerInputError("task_id must be a string when present");
  }
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0) {
    throw new HandlerInputError("limit must be a non-negative number");
  }
  if (typeof offset !== "number" || !Number.isFinite(offset) || offset < 0) {
    throw new HandlerInputError("offset must be a non-negative number");
  }

  let rows = readAllEvents();
  if (run_id) rows = rows.filter((r) => r.run_id === run_id);
  if (event_type) rows = rows.filter((r) => r.event_type === event_type);
  if (task_id) rows = rows.filter((r) => r.task_id === task_id);
  rows.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return rows.slice(offset, offset + limit);
}

function handleSummary(args) {
  const run_id = _requireString(args, "run_id");
  const events = readAllEvents()
    .filter((r) => r.run_id === run_id)
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));

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
    parse_errors: [],
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
      const { data, parse_error } = _parseStoredData(event.data);
      if (parse_error) {
        summary.parse_errors.push({ event_id: event.id, parse_error });
        continue;
      }
      if (data.passed) {
        summary.quality_gates.passed++;
      } else {
        summary.quality_gates.failed++;
      }
    }
  }

  if (summary.parse_errors.length === 0) {
    delete summary.parse_errors;
  }

  return summary;
}

function handleExport(args) {
  const run_id = _requireString(args, "run_id");
  return readAllEvents()
    .filter((r) => r.run_id === run_id)
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
    .map((row) => {
      const { data, parse_error } = _parseStoredData(row.data);
      const out = { ...row, data };
      if (parse_error) {
        out.data_parse_error = parse_error;
      }
      return out;
    });
}

function dispatchTool(name, args) {
  let result;
  try {
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
  } catch (err) {
    if (err instanceof HandlerInputError) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { error: err.message, tool: name, kind: "input_validation" },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
    process.stderr.write(
      `pipeline-metrics ${name} failed: ${err.stack || err.message}\n`,
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { error: err.message, tool: name, kind: "internal_error" },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}

// ---------- MCP JSON-RPC 2.0 stdio transport ----------
// Messages are newline-delimited JSON objects (LSP-style framing is not
// required by Claude Code's stdio MCP client, which uses NDJSON).

const SERVER_INFO = { name: "pipeline-metrics", version: "0.2.0" };
const PROTOCOL_VERSION = "2024-11-05";

function write(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function respond(id, result) {
  write({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

function handleMessage(msg) {
  const { id, method, params } = msg;
  // Notifications (no id) get no response.
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize":
      if (isNotification) return;
      return respond(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case "notifications/initialized":
    case "initialized":
      // Ack-only notification; nothing to do.
      return;

    case "tools/list":
      if (isNotification) return;
      return respond(id, { tools: TOOLS });

    case "tools/call": {
      if (isNotification) return;
      const name = params?.name;
      const args = params?.arguments || {};
      if (typeof name !== "string") {
        return respondError(id, -32602, "Invalid params: missing tool name");
      }
      return respond(id, dispatchTool(name, args));
    }

    case "ping":
      if (isNotification) return;
      return respond(id, {});

    default:
      if (isNotification) return;
      return respondError(id, -32601, `Method not found: ${method}`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line.length === 0) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      write({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: `Parse error: ${err.message}` },
      });
      continue;
    }
    try {
      handleMessage(msg);
    } catch (err) {
      const id = msg?.id ?? null;
      process.stderr.write(
        `pipeline-metrics dispatch failed: ${err.stack || err.message}\n`,
      );
      respondError(id, -32603, `Internal error: ${err.message}`);
    }
  }
});

process.stdin.on("end", () => process.exit(0));
