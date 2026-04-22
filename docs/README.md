<!-- last-documented: be4207eba1e3e12c348d1f325c532304e6296bca -->

# Dark Factory Plugin

A Claude Code plugin that converts GitHub PRD (Product Requirements Document) issues into merged pull requests with minimal human intervention. The plugin implements a 9-phase autonomous coding pipeline with quality-first review gates and adversarial code review.

## What Problem It Solves

The plugin automates the end-to-end software development workflow: reading a requirements document, generating a specification, decomposing work into tasks, implementing code, writing tests, reviewing changes adversarially, and creating pull requests. Human touchpoints are explicit and configurable rather than required at every step.

## Design Philosophy

**Deterministic-first architecture.** The plugin maintains a 3.5:1 ratio of deterministic components (bin scripts, hooks) to non-deterministic (agents). Agent instructions are followed approximately 70% of the time; hooks and scripts enforce at 100%. This hybrid approach uses agents for judgment tasks (code generation, review) while delegating all validation, state management, classification, and parsing to shell scripts.

**Quality over speed.** Every task output passes through a 5-layer quality gate stack (static analysis, tests, coverage regression, holdout validation, mutation testing) and multi-round adversarial code review before reaching a pull request.

**Resumable execution.** All state is persisted to JSON files. Interrupted runs recover from the last checkpoint via `/factory:run resume`.

---

## Table of Contents

### Getting Started

- [Getting Started](./getting-started.md) - Installation, configuration, and first run

### Architecture

- [System Overview](./architecture/overview.md) - Pipeline stages, component relationships, data flow
- [Components](./architecture/components.md) - Agents, hooks, bin scripts, MCP servers

### How-To Guides

- [Running the Pipeline](./guides/running-pipeline.md) - Operating modes and invocation patterns
- [Configuring Settings](./guides/configuration.md) - Adjusting quality gates, review rounds, and autonomy levels

### Reference

- [Commands](./reference/commands.md) - `/factory:run` and `/factory:configure` specifications
- [Configuration Schema](./reference/configuration.md) - All runtime config options with types and defaults
- [Bin Scripts](./reference/bin-scripts.md) - Deterministic pipeline utilities
- [State Schema](./reference/state-schema.md) - Run state structure and task lifecycle
- [Exit Codes](./reference/exit-codes.md) - Script exit codes and their meanings

### Explanation

- [Quality Gates](./explanation/quality-gates.md) - The 5-layer quality stack and why each layer exists
- [Adversarial Review](./explanation/adversarial-review.md) - Actor-Critic pattern and review protocol
- [Rate Limiting](./explanation/rate-limiting.md) - 5h and 7d budget management with pause/end_gracefully behavior
- [Design Decisions](./explanation/decisions.md) - Key architectural choices and their rationale
