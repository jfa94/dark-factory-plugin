---
name: database-design-review
description: 'Review criteria for relational schema changes — the checklist the database-design-reviewer applies to migrations and DDL in a task diff. Iron Laws (categorical, blocking) + Decision Gates (trade-offs, non-blocking unless unjustified and harmful) + the anti-pattern catalogue. Loaded alongside review-protocol; findings emit as RawReview JSON.'
---

# Database Design Review

You judge **schema and migration changes** against relational-design discipline. Two tiers:

- **Iron Laws** — categorical. A violation corrupts data or is unambiguously wrong: `blocking: true`, severity `critical` or `error`.
- **Decision Gates** — genuine trade-offs. Deviating from the default is a finding ONLY when the deviation is both unexplained (no comment/spec justification visible) and harmful at the schema's evident scale: `blocking: false`, severity `warning` — unless the deviation is an Iron-Law violation in disguise.

Principles are engine-agnostic; examples Postgres-first. Query/EXPLAIN tuning, runtime concurrency, sharding, and backups are OUT of scope — do not flag them.

## Scope

Review ONLY the DB-touching files in the diff: migrations, `*.sql`, ORM schema files (`schema.prisma`, drizzle schemas), and any DDL embedded in changed code. App-logic quality belongs to the other panel members; the one app-code question you own is G8 (a data invariant enforced only in app code when the DB could enforce it).

A diff whose DB files are all clean → `verdict: "approve"` with empty findings. `*.sql` files that are pure seeds/queries with no design implications are fine — do not invent findings.

## The Iron Laws (blocking)

1. **Every enforceable invariant is declared** — NOT NULL, FOREIGN KEY (with a deliberate ON DELETE action), UNIQUE, CHECK. Test: _if a rogue script bypassed the app, would breaking this rule corrupt the data?_ If yes and the constraint is missing, that's the finding. A reference column with no FK ("for flexibility") is Keyless Entry.
2. **Money is never binary floating point.** `FLOAT`/`DOUBLE`/`REAL`/`MONEY` near an amount → blocking. Expect DECIMAL/NUMERIC(p,s) or integer minor units, with ISO-4217 currency alongside when more than one is possible.
3. **Instants in UTC.** An event time in naive `timestamp` (no zone) → blocking. Calendar date → `DATE`; future/civil local time → local time + IANA zone name. Sentinel dates (`9999-12-31`) → blocking (also L8).
4. **One value per cell (1NF).** Comma-separated lists, `tag1/tag2/tag3` repeating columns, an array standing in for a relationship → blocking. Expect a junction/dependent table.
5. **Stated grain and a primary key.** A table whose rows mix grains, or with no PK at all → blocking.
6. **Migrations are versioned; live breaking changes use expand–contract.** A one-step destructive ALTER (`DROP`/retype/rename of a column or table that pre-existing code evidently depends on) → blocking: rolling deploys run old + new code at once. Destroying a shape the SAME diff introduced is fine. Hand-edit-style un-versioned DDL (schema change outside the repo's migration mechanism) → blocking.
7. **No EAV or polymorphic FKs by default.** Generic `(entity, attribute, value)` rows, or a `(thing_type, thing_id)` pair pointing at several tables → blocking unless the diff/spec explicitly justifies extreme sparsity. Expect typed columns, a JSONB tail for genuinely dynamic/sparse data, exclusive arcs or a shared supertype for polymorphism.
8. **NULL means unknown, never a sentinel.** `-1`, `'N/A'`, magic dates encoding "missing" → blocking. (Note: a nullable UNIQUE column admits many NULLs — flag code that assumes it caps missing values at one.)
9. **Never plaintext credentials.** A password/secret/token column with no evident hashing (bcrypt/scrypt/Argon2) on the write path → blocking, severity critical.

## Decision Gates (non-blocking unless unjustified AND harmful)

| Gate                  | Default                                       | Flag when the diff…                                                                                                                                                      |
| --------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1 Key strategy       | Surrogate PK + UNIQUE natural key             | has a natural key but no UNIQUE on it; or bolts `id` onto a pure junction/lookup table                                                                                   |
| G2 Key type           | BIGINT (single DB); UUIDv7 if distributed     | uses UUIDv4 PKs at evident scale with no stated reason; stores UUIDs as text                                                                                             |
| G3 Normalise          | 3NF/BCNF                                      | duplicates a fact across rows (drift risk) or denormalises with no measurement/reason                                                                                    |
| G4 Delete strategy    | Hard delete + archive, or lifecycle status    | adds `deleted_at` by reflex, or soft-deletes without a partial unique index on live rows                                                                                 |
| G5 Tree model         | Adjacency list + recursive CTE                | hand-rolls a tree shape that can't serve its evident queries                                                                                                             |
| G6 Inheritance        | per hierarchy: STI / CTI / concrete           | mixes subtype strategies incoherently in one hierarchy                                                                                                                   |
| G7 Dynamic attributes | Real columns → lookup → JSONB+GIN → EAV       | reaches for JSONB/EAV for attributes that are clearly fixed and typed                                                                                                    |
| G8 Where a rule lives | Invariant → DB constraint                     | enforces a data invariant only in app code when a constraint/CHECK could hold it (→ L1)                                                                                  |
| G9 Tenancy            | Shared schema + mandatory `tenant_id` (+ RLS) | multi-tenant schema with tenant-owned tables lacking `tenant_id`, or per-tenant uniqueness as `UNIQUE(x)` instead of `UNIQUE(tenant_id, x)`, and no stated tenancy model |

Naming (snake_case, FK named after the referenced table, no reserved words) and design-level indexing (FK columns unindexed, composite order wrong for the evident access path, missing partial-unique for soft-delete) are `warning`, non-blocking.

## Anti-pattern quick reference

| Anti-pattern             | Smell in the diff                                              | Maps to |
| ------------------------ | -------------------------------------------------------------- | ------- |
| Jaywalking               | CSV of FKs in one column                                       | L4      |
| Multicolumn Attributes   | `tag1, tag2, tag3`                                             | L4      |
| Keyless Entry            | reference columns with no FK                                   | L1      |
| ID Required              | surrogate `id` on a pure junction table                        | G1      |
| EAV                      | `(entity, attribute, value)` catch-all                         | L7, G7  |
| Polymorphic Associations | `(thing_type, thing_id)` at several tables                     | L7      |
| Metadata Tribbles        | `orders_2024`, `orders_2025` hand-split tables                 | L5      |
| Rounding Errors          | FLOAT for money                                                | L2      |
| 31 Flavors               | native enum / hardcoded CHECK-IN for a set that keeps changing | G7      |
| Fear of the Unknown      | sentinel values instead of NULL                                | L8      |
| Naive time               | naive `timestamp` for events                                   | L3      |
| Readable Passwords       | plaintext/reversible credentials                               | L9      |
| Diplomatic Immunity      | DDL outside versioned migrations                               | L6      |

## Red flags — look twice

- A new table with no stated/deducible grain, or columns that mix grains (L5).
- `type` + `id` column pair → polymorphic FK (L7).
- A migration that both adds and drops the same live shape in one step (L6).
- `LIKE '%term%'` as the evident search plan for a new column → note full-text as `warning`.
- Every table growing `deleted_at` by reflex (G4).
- Multi-tenant tables with no `tenant_id` and no recorded tenancy decision (G9).

## Severity mapping

- Iron Law violation → `blocking: true`; L9 (credentials) and L2 (money) are `critical`, others `error`.
- Gate deviation, unjustified AND harmful → `blocking: false`, `warning` (escalate to blocking only when it is an Iron Law in disguise — e.g. G8 miss that leaves a corruptible invariant unenforced is L1).
- Naming/indexing/style → `blocking: false`, `warning`. Never block on taste.

## Citations

Quote the offending DDL/schema line verbatim from the file in the worktree (the migration file, `schema.prisma`, etc.) at its real `file:line` — never a diff `+`/`-` line rendering. The claim states the rule violated and the concrete corruption/failure it permits.
