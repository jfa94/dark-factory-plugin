/**
 * The e2e SUITE leg — the mechanical heart of the phase (`runSuiteAndDecide`: resync,
 * run, join failures to tasks, apply the Decision 39 cadence + disposition rules) —
 * PLUS the D7 adjudication sub-machine (prompt/spawn/record for the regression-vs-
 * intentional-change ruling on pre-existing failing specs). Colocated in one module
 * because `runSuiteAndDecide` and `recordAdjudication` are mutually recursive; the
 * crash-retry re-enters the facade's dispatch via the threaded {@link EmitFn}.
 */
import {join} from 'node:path'
import {E2E_TEST_DIR} from './e2e-paths.js'
import {ensureStageWorktree, publishToStaging, specTaskLines} from './stage-helpers.js'
import {
    resetTaskRow,
    parseProducerStatus,
    runE2e,
    DefaultPlaywrightTool,
    provisionWorktree,
    removeWorktreeBestEffort,
    E2E_AUTHOR_AGENT_TYPE,
    type RunState,
    type SpecManifest,
    type E2eAdjudication,
    type E2eAdjudicationSpec,
    type E2eManifestEntry,
    type E2eSpecResult,
} from './deps.js'
import {nonNull, nowIso, createLogger} from '../shared/index.js'
import {CONTROL_TITLE_PREFIX, type E2eAuthorResults} from './e2e-schemas.js'
import {
    e2eRunWorktreePath,
    e2eThrowawayDir,
    e2eAdjudicateWorktreePath,
    adjudicateBranchName,
    resolveBootConfig,
    scrubbedE2eEnv,
    type BootConfig,
} from './e2e-paths.js'
import {
    DefaultE2eFileOps,
    defaultE2ePhase,
    errText,
    findEntry,
    markDone,
    markFailed,
    specPathMatches,
    unattributableToolingFailure,
    E2E_AUTHOR_MODEL,
    MAX_AUTHOR_ATTEMPTS,
    type E2eAction,
    type E2eRunDeps,
    type EmitFn,
} from './e2e-shared.js'
import {proveCriticals} from './e2e-proof.js'

const log = createLogger('e2e')

/** Build the adjudicator prompt (D7): rule each unmapped failing spec regression vs
 * intentional-change, then rewrite every pre-authorized/ruled-intentional spec. */
function buildAdjudicationPrompt(args: {
    worktree: string
    boot: BootConfig
    cursor: E2eAdjudication
    spec: SpecManifest
}): string {
    const taskLines = specTaskLines(args.spec)
    const specLines = (rows: readonly E2eAdjudicationSpec[]): string =>
        rows
            .map((s) => {
                const detail = s.error === undefined ? '' : `\n    ${s.error.replace(/\n/g, '\n    ')}`
                return `  - ${s.spec_path} — "${s.title}"${detail}`
            })
            .join('\n')
    const adjudicate = args.cursor.specs.filter((s) => s.mode === 'adjudicate')
    const update = args.cursor.specs.filter((s) => s.mode === 'update')
    const lines = [
        'You are the factory e2e-adjudicator: pre-existing committed e2e specs are failing ' +
            'against staging and no manifest entry maps them to a task in this run. Decide ' +
            'whether each failure is a REGRESSION this run introduced or an INTENTIONAL ' +
            "behavior change this run's spec authorizes.",
        `1. cd into your worktree: ${args.worktree} (checked out on the adjudication branch off the staging tip).`,
        `2. Boot the app: \`${args.boot.startCommand}\` → ${args.boot.baseURL} (reuse if already running).`,
        "3. The tasks this run delivered (the ONLY authority for 'intentional'):",
        taskLines,
    ]
    if (adjudicate.length > 0) {
        lines.push(
            '4. ADJUDICATE each failing spec below — read its source, reproduce against the live app:',
            specLines(adjudicate),
            '   Verdict "regression": the old behavior should still work and this run broke it.',
            '   Verdict "intentional-change": a task above deliberately changed this behavior — you ' +
                'MUST include a `citation` quoting the authorizing task/criterion language verbatim; ' +
                'an uncited intentional-change verdict is rejected.'
        )
    }
    if (update.length > 0 || adjudicate.length > 0) {
        lines.push(
            `${adjudicate.length > 0 ? '5' : '4'}. UPDATE these pre-authorized specs${
                adjudicate.length > 0 ? ' plus every spec you ruled intentional-change' : ''
            } — rewrite each to assert the NEW behavior, keep its "${CONTROL_TITLE_PREFIX}"-titled ` +
                'assertion, validate it green against the live staging app, and COMMIT it in this worktree:',
            ...(update.length > 0 ? [specLines(update)] : [])
        )
    }
    lines.push(
        'Only the spec files listed above may change — touching anything else fails the run. Do NOT push.',
        'Finish with your terminal STATUS line and return {"status": "<line>", "verdicts": [...]} — ' +
            'one {spec_path, verdict, reason, citation?} row per ADJUDICATED spec only (pre-authorized ' +
            'updates need no verdict row); `reason` is plain language a non-technical reader understands.'
    )
    return lines.join('\n')
}

/** Prepare (idempotently) the adjudicator worktree + spawn off the persisted cursor (D7). */
export async function prepareAdjudicatorSpawn(
    deps: E2eRunDeps,
    run: RunState,
    runId: string,
    boot: BootConfig
): Promise<E2eAction> {
    const cursor = run.e2e_phase?.adjudication
    if (cursor === undefined) {
        throw new Error(`run '${runId}': prepareAdjudicatorSpawn called with no adjudication cursor`)
    }
    const staging = run.staging_branch
    const branch = adjudicateBranchName(runId)
    const worktree = e2eAdjudicateWorktreePath(deps.workDir, runId)

    await deps.git.fetch('origin', staging)
    // Retry-reset: a crashed adjudicator's partial work is discarded (mirrors D5).
    await ensureStageWorktree(deps.git, {
        worktree,
        ref: `origin/${staging}`,
        branch,
        resetIfExists: cursor.attempts >= 1,
        provision: () =>
            (deps.provision ?? provisionWorktree)({
                path: worktree,
                setupCommand: deps.config.quality.setupCommand,
            }),
    })

    return {
        kind: 'spawn',
        expects: 'adjudication-results',
        run_id: runId,
        agent_type: E2E_AUTHOR_AGENT_TYPE,
        worktree,
        staging_branch: staging,
        adjudicate_branch: branch,
        model: E2E_AUTHOR_MODEL,
        prompt: buildAdjudicationPrompt({worktree, boot, cursor, spec: deps.spec}),
    }
}

/** Fail the phase AND clear the adjudication cursor + worktree — every
 * {@link recordAdjudication} failure exit routes through here so a failed run never
 * leaves a live cursor behind (emit would re-spawn against a removed worktree). */
async function failAdjudication(
    deps: E2eRunDeps,
    runId: string,
    worktree: string,
    reason: string
): Promise<Extract<E2eAction, {kind: 'failed'}>> {
    await removeWorktreeBestEffort(deps.git, worktree)
    await deps.state.update(runId, (s) =>
        s.e2e_phase === undefined ? s : {...s, e2e_phase: {...s.e2e_phase, adjudication: undefined}}
    )
    await markFailed(deps, runId, reason)
    return {kind: 'failed', run_id: runId, reason}
}

/** Adjudicator crash/no-STATUS → one automatic re-spawn, same cap + rationale as
 * the author's retry (D5); the attempt count lives on the cursor. */
async function retryAdjudicatorOrFail(
    deps: E2eRunDeps,
    runId: string,
    worktree: string,
    reason: string,
    emit: EmitFn
): Promise<E2eAction> {
    const run = await deps.state.read(runId)
    const cursor = run.e2e_phase?.adjudication
    const attempts = (cursor?.attempts ?? 0) + 1
    if (attempts >= MAX_AUTHOR_ATTEMPTS) {
        return failAdjudication(deps, runId, worktree, `${reason} (after ${attempts} attempts)`)
    }
    await deps.state.update(runId, (s) =>
        s.e2e_phase?.adjudication === undefined
            ? s
            : {
                  ...s,
                  e2e_phase: {
                      ...s.e2e_phase,
                      adjudication: {...s.e2e_phase.adjudication, attempts},
                  },
              }
    )
    log.warn(
        `run '${runId}': e2e-adjudicator attempt ${attempts}/${MAX_AUTHOR_ATTEMPTS} failed — re-spawning (${reason})`
    )
    return emit(deps, runId)
}

/**
 * Record the adjudicator's verdicts (D7): any `regression` fails the run loud with
 * the adjudicator's plain-language reason; all-intentional (verdicts complete, every
 * intentional-change cited) gates the rewritten specs exactly like fresh-authored
 * ones — diff scope, fail-first re-proof, merge — then clears the cursor, stamps the
 * per-spec adjudication count (cap 1/run), and re-runs the suite.
 */
export async function recordAdjudication(
    deps: E2eRunDeps,
    runId: string,
    run: RunState,
    results: E2eAuthorResults,
    emit: EmitFn
): Promise<E2eAction> {
    const worktree = e2eAdjudicateWorktreePath(deps.workDir, runId)
    // Non-null by the runE2eRecord dispatch guard.
    const phase = nonNull(run.e2e_phase)
    const cursor = nonNull(phase.adjudication)

    const outcome = parseProducerStatus(results.status)
    if (outcome.status === 'error') {
        return retryAdjudicatorOrFail(deps, runId, worktree, `e2e-adjudicator: ${outcome.reason}`, emit)
    }
    if (outcome.status !== 'done') {
        const reason = `e2e-adjudicator: ${'reason' in outcome ? outcome.reason : 'no parseable status'}`
        return failAdjudication(deps, runId, worktree, reason)
    }

    // Verdict completeness — an incomplete/malformed response is a retryable crash-
    // equivalent (the adjudicator half-finished), not a deliberate ruling.
    const verdicts = results.verdicts ?? []
    const cursorPaths = new Set(cursor.specs.map((s) => s.spec_path))
    const ruled = new Set(verdicts.map((v) => v.spec_path))
    const unruled = cursor.specs.filter((s) => s.mode === 'adjudicate' && !ruled.has(s.spec_path))
    const unknown = verdicts.filter((v) => !cursorPaths.has(v.spec_path))
    const uncited = verdicts.filter(
        (v) => v.verdict === 'intentional-change' && (v.citation === undefined || v.citation === '')
    )
    if (unruled.length > 0 || unknown.length > 0 || uncited.length > 0) {
        const parts = [
            ...(unruled.length > 0 ? [`missing verdict(s) for: ${unruled.map((s) => s.spec_path).join(', ')}`] : []),
            ...(unknown.length > 0
                ? [`verdict(s) for spec(s) not under adjudication: ${unknown.map((v) => v.spec_path).join(', ')}`]
                : []),
            ...(uncited.length > 0
                ? [
                      `intentional-change verdict(s) missing the required citation: ${uncited.map((v) => v.spec_path).join(', ')}`,
                  ]
                : []),
        ]
        return retryAdjudicatorOrFail(deps, runId, worktree, `e2e-adjudicator: ${parts.join('; ')}`, emit)
    }

    const regressions = verdicts.filter((v) => v.verdict === 'regression')
    if (regressions.length > 0) {
        const reason =
            'e2e adjudication: regression verdict — ' + regressions.map((v) => `${v.spec_path}: ${v.reason}`).join('; ')
        return failAdjudication(deps, runId, worktree, reason)
    }

    // All intentional — gate the rewritten specs exactly like fresh-authored ones.
    const staging = run.staging_branch
    const changed = await deps.git.diffNames(staging, adjudicateBranchName(runId), {
        cwd: worktree,
    })
    const stray = changed.filter((f) => !cursorPaths.has(f))
    if (stray.length > 0) {
        const reason =
            'e2e-adjudicator: branch touches path(s) outside the adjudicated spec set — ' +
            `refusing to merge unreviewed changes: ${stray.join(', ')}`
        return failAdjudication(deps, runId, worktree, reason)
    }
    const unrewritten = cursor.specs.filter((s) => !changed.includes(s.spec_path))
    if (unrewritten.length > 0) {
        return retryAdjudicatorOrFail(
            deps,
            runId,
            worktree,
            `e2e-adjudicator: spec(s) not rewritten: ${unrewritten.map((s) => s.spec_path).join(', ')}`,
            emit
        )
    }

    const boot = resolveBootConfig(deps.config.e2e, run)
    if (boot === null) {
        return failAdjudication(
            deps,
            runId,
            worktree,
            'e2e-adjudicator: boot config vanished between spawn and record (config or assessment state changed mid-run)'
        )
    }
    // Fail-first re-proof: the rewritten spec must be red on base (new behavior absent
    // there) and green on the adjudicator's worktree — same trust boundary as authoring.
    const proof = await proveCriticals(
        deps,
        runId,
        changed.map((f) => ({task_ids: [], spec_path: f, kind: 'critical' as const})),
        worktree,
        boot
    )
    if (!proof.ok) {
        return failAdjudication(deps, runId, worktree, `e2e adjudication re-proof: ${proof.reason}`)
    }

    await publishToStaging(deps.git, staging, adjudicateBranchName(runId))
    await removeWorktreeBestEffort(deps.git, worktree)

    await deps.state.update(runId, (s) => {
        if (s.e2e_phase === undefined) {
            return s
        }
        const counts = {...(s.e2e_phase.adjudication_counts ?? {})}
        for (const spec of cursor.specs) {
            counts[spec.spec_path] = (counts[spec.spec_path] ?? 0) + 1
        }
        return {
            ...s,
            e2e_phase: {...s.e2e_phase, adjudication: undefined, adjudication_counts: counts},
        }
    })
    log.info(`run '${runId}': e2e adjudication merged ${cursor.specs.length} updated spec(s) — re-running the suite`)
    return runSuiteAndDecide(deps, runId)
}

/** Where the generated throwaway-suite Playwright config lives — inside the run
 * worktree (never committed, never staged) so its own `require("@playwright/test")`
 * resolves via THAT worktree's `node_modules`, even though `testDir` inside it
 * points at the gitignored throwaway dir. */
function throwawayConfigPath(worktree: string): string {
    return join(worktree, '.factory-e2e-throwaway.config.cjs')
}

/** CommonJS (not TS/ESM) — loads regardless of the target repo's package.json `type`. */
function throwawayConfigContents(throwawayDir: string): string {
    return [
        '// Generated by the factory e2e coroutine — never commit, rewritten every run.',
        'const { defineConfig } = require("@playwright/test");',
        'module.exports = defineConfig({',
        `  testDir: ${JSON.stringify(throwawayDir)},`,
        '  use: { baseURL: process.env.BASE_URL },',
        '  webServer: {',
        '    command: process.env.FACTORY_E2E_START_COMMAND,',
        '    url: process.env.BASE_URL,',
        '    reuseExistingServer: process.env.FACTORY_E2E ? false : true,',
        '    timeout: Number(process.env.FACTORY_E2E_READY_TIMEOUT_MS) || 30_000,',
        '  },',
        '});',
        '',
    ].join('\n')
}

/**
 * The mechanical heart of the phase: sync the run-worktree to CURRENT staging, run
 * the full suite (critical + throwaway), join failures to tasks via the manifest,
 * and apply the cadence + disposition (Decision 39) rules.
 */
export async function runSuiteAndDecide(deps: E2eRunDeps, runId: string): Promise<E2eAction> {
    const run = await deps.state.read(runId)
    const manifest = run.e2e_phase?.manifest ?? []
    const attempts = (run.e2e_phase?.attempts ?? 0) + 1
    const firstPass = attempts === 1
    const cfg = deps.config.e2e

    /** Persist the failed phase + emit the failed action — the 7 fail exits below. */
    const failPhase = async (reason: string): Promise<E2eAction> => {
        await markFailed(deps, runId, reason, attempts)
        return {kind: 'failed', run_id: runId, reason}
    }

    if (manifest.length === 0) {
        // The author judged nothing in this PRD to be UI-facing — nothing to gate on.
        await markDone(deps, runId, {attempts})
        return {kind: 'done', run_id: runId}
    }

    // Emit's suspend backstop gates entry, but this leg is also reached from record —
    // a mid-run config/assessment mutation must fail loud, not boot a fabricated app.
    const boot = resolveBootConfig(cfg, run)
    if (boot === null) {
        return failPhase('e2e suite has no boot config — the run-start assessment resolved none and no override is set')
    }

    const staging = run.staging_branch
    const worktree = e2eRunWorktreePath(deps.workDir, runId)
    const provision = deps.provision ?? provisionWorktree
    await deps.git.fetch('origin', staging)
    // Always resync on reuse — a reopened task's re-ship advanced staging since the
    // last pass. Provision stays OUTSIDE (below): it must run on create AND every resync.
    await ensureStageWorktree(deps.git, {
        worktree,
        ref: `origin/${staging}`,
        branch: `e2e-run-${runId}`,
        resetIfExists: true,
    })
    // Provisioned on first creation AND every resync — staging may have gained a
    // new dependency between reopen passes.
    await provision({path: worktree, setupCommand: deps.config.quality.setupCommand})

    const tool = deps.playwright ?? new DefaultPlaywrightTool()
    // runE2e THROWS on a tooling-level failure (missing Playwright binary, empty/
    // truncated reporter output) — persist a failed phase instead of crashing the
    // record with the phase cursor left dangling.
    let criticalResult
    try {
        criticalResult = await runE2e(
            {cwd: worktree, env: scrubbedE2eEnv(cfg, boot), replaceEnv: true, testDir: E2E_TEST_DIR},
            tool
        )
    } catch (err) {
        return failPhase(`e2e critical suite tooling error: ${errText(err)}`)
    }
    const throwaway = manifest.filter((e) => e.kind === 'throwaway')
    let throwawayResult
    let throwawayThrew: string | undefined
    if (throwaway.length > 0) {
        const throwawayDir = e2eThrowawayDir(deps.workDir, runId)
        const configPath = throwawayConfigPath(worktree)
        await (deps.files ?? new DefaultE2eFileOps()).writeConfig(configPath, throwawayConfigContents(throwawayDir))
        try {
            throwawayResult = await runE2e(
                {cwd: worktree, env: scrubbedE2eEnv(cfg, boot), replaceEnv: true, config: configPath},
                tool
            )
        } catch (err) {
            if (firstPass) {
                return failPhase(`e2e throwaway suite tooling error: ${errText(err)}`)
            }
            // Pass 2+ throwaway is non-gating (Decision 39) — fold the crash into the
            // advisory below instead of failing the run.
            throwawayThrew = errText(err)
        }
    }

    // A manifest `critical` entry only counts as proven when ITS spec is present in the
    // results AND passed/flaky — absent (never collected) or explicitly failed/skipped
    // are all the same non-pass outcome. Stop treating "no spec in `failed`" as a pass.
    const criticalEntries = manifest.filter((e) => e.kind === 'critical')
    const criticalMisses = criticalEntries
        .map((entry) => ({
            entry,
            spec: criticalResult.specs.find((s) => specPathMatches(s.file, entry.spec_path)),
        }))
        .filter((m) => m.spec === undefined || (m.spec.status !== 'passed' && m.spec.status !== 'flaky'))

    // A tooling-level failure (nonzero exit / reporter errors[]) that no individual
    // spec's status explains can't be attributed to any task — fail the run outright
    // rather than silently absorbing it into a critical-miss reopen.
    if (unattributableToolingFailure(criticalResult)) {
        return failPhase(
            'e2e critical suite reported a tooling failure (nonzero exit code or reporter ' +
                'errors[]) with no individual spec marked failed — refusing to attribute to a task'
        )
    }

    // Same tooling-failure blind spot as above, but for the throwaway run: a broken
    // throwaway config/tool invocation (`ok:false`, no spec marked `failed`) would
    // otherwise fall through to an empty `throwawayFailed` and silently `markDone`.
    // Only gate on pass 1 — pass 2+ throwaway is already non-gating (Decision 39), so
    // a tooling failure there is folded into the advisory instead (see below).
    if (firstPass && throwawayResult && unattributableToolingFailure(throwawayResult)) {
        return failPhase(
            'e2e throwaway suite reported a tooling failure (nonzero exit code or reporter ' +
                'errors[]) with no individual spec marked failed — refusing to attribute to a task'
        )
    }

    const criticalSpecFailures = criticalResult.specs.filter((s) => s.status === 'failed')
    const throwawayFailed = throwawayResult?.specs.filter((s) => s.status === 'failed') ?? []
    const unmappableCritical = criticalSpecFailures.filter((s) => findEntry(manifest, s) === undefined)

    // Unmappable = a PRE-EXISTING committed spec (this run's manifest doesn't name it)
    // is failing. Route three ways off the assessment's affected-specs forecast (D7):
    // mapped should-still-pass → reopen its tasks like any manifest failure;
    // needs-update → adjudicator in pre-authorized update mode; unmapped/unforecast →
    // adjudicator rules regression vs intentional-change. One adjudication per spec
    // per run — failing AGAIN after its update merged is a regression, fail loud.
    const stillPass: {spec: E2eSpecResult; entry: E2eManifestEntry}[] = []
    if (unmappableCritical.length > 0) {
        const affected = run.e2e_assessment?.affected_specs ?? []
        const counts = run.e2e_phase?.adjudication_counts ?? {}
        const readjudicated: string[] = []
        const cursorSpecs: E2eAdjudicationSpec[] = []
        for (const s of unmappableCritical) {
            const row = affected.find((r) => specPathMatches(s.file, r.spec_path))
            const specPath =
                row?.spec_path ?? (s.file.startsWith(`${E2E_TEST_DIR}/`) ? s.file : `${E2E_TEST_DIR}/${s.file}`)
            if ((counts[specPath] ?? 0) >= 1) {
                readjudicated.push(specPath)
            } else if (row?.expectation === 'should-still-pass') {
                stillPass.push({
                    spec: s,
                    entry: {task_ids: [...row.task_ids], spec_path: row.spec_path, kind: 'critical'},
                })
            } else {
                cursorSpecs.push({
                    spec_path: specPath,
                    title: s.title,
                    ...(s.error !== undefined ? {error: s.error} : {}),
                    mode: row?.expectation === 'needs-update' ? 'update' : 'adjudicate',
                })
            }
        }
        if (readjudicated.length > 0) {
            return failPhase(
                'pre-existing e2e spec(s) failing AGAIN after their one adjudication — treating ' +
                    `as a regression: ${readjudicated.join(', ')}`
            )
        }
        if (cursorSpecs.length > 0) {
            // Task-attributed reopens (stillPass + any mappable misses) wait for the
            // post-adjudication suite re-run — one decision at a time. Suite `attempts`
            // is deliberately NOT persisted here: this pass didn't conclude, and the
            // re-run recomputes the same value.
            await deps.state.update(runId, (st) => ({
                ...st,
                e2e_phase: {
                    ...(st.e2e_phase ?? defaultE2ePhase()),
                    adjudication: {specs: cursorSpecs, attempts: 0, requested_at: nowIso()},
                },
            }))
            log.info(`run '${runId}': ${cursorSpecs.length} pre-existing failing spec(s) sent to adjudication`)
            return prepareAdjudicatorSpawn(deps, await deps.state.read(runId), runId, boot)
        }
    }

    // Cadence (Decision 39): pass 1 reopens for ANY mappable failure (critical + throwaway);
    // pass 2+ reopens ONLY for critical. A still-red throwaway on pass 2+ is dropped here —
    // it never blocks (only critical red gates disposition) and never reopens.
    const throwawayCandidates = firstPass
        ? throwawayFailed
              .map((spec) => ({spec, entry: findEntry(manifest, spec)}))
              .filter((m): m is {spec: E2eSpecResult; entry: E2eManifestEntry} => m.entry !== undefined)
        : []
    const mappable: {spec?: E2eSpecResult | undefined; entry: E2eManifestEntry}[] = [
        ...criticalMisses,
        ...throwawayCandidates,
        ...stillPass,
    ]

    if (mappable.length === 0) {
        // Pass 2+ throwaway tooling failures never gate (Decision 39), but must still
        // surface — otherwise this branch would silently `markDone` past a broken
        // throwaway run.
        const throwawayToolingFailed =
            !firstPass &&
            (throwawayThrew !== undefined ||
                (throwawayResult !== undefined && unattributableToolingFailure(throwawayResult)))
        const advisory =
            throwawayFailed.length > 0
                ? `${throwawayFailed.length} throwaway spec(s) still red (non-gating): ` +
                  throwawayFailed.map((s) => s.title).join(', ')
                : throwawayToolingFailed
                  ? 'throwaway suite reported a tooling failure (non-gating)'
                  : undefined
        await markDone(deps, runId, {attempts, advisory})
        return {kind: 'done', run_id: runId}
    }

    const taskIds = [...new Set(mappable.flatMap((m) => m.entry.task_ids))]
    const reopenCounts = {...(run.e2e_phase?.reopen_counts ?? {})}
    const capExhausted = taskIds.filter((id) => (reopenCounts[id] ?? 0) >= cfg.reopenCap)
    if (capExhausted.length > 0) {
        return failPhase(`e2e reopen cap (${cfg.reopenCap}) exhausted for task(s): ${capExhausted.join(', ')}`)
    }

    const feedback =
        'The e2e phase found these journeys still failing:\n' +
        mappable
            .map((m) => {
                const title = m.spec ? m.spec.title : 'did not run (missing from results)'
                // D8 (Decision 40): the failing assertion/step, already ANSI-stripped +
                // byte-capped by the runner — without it a reopened producer starts blind.
                const detail =
                    m.spec?.error != null && m.spec.error.length > 0 ? `\n  ${m.spec.error.replace(/\n/g, '\n  ')}` : ''
                return `- ${m.entry.spec_path} — "${title}"${detail}`
            })
            .join('\n')
    for (const id of taskIds) {
        reopenCounts[id] = (reopenCounts[id] ?? 0) + 1
    }

    await deps.state.update(runId, (s) => ({
        ...s,
        tasks: Object.fromEntries(
            Object.entries(s.tasks).map(([id, t]) =>
                taskIds.includes(id) ? [id, resetTaskRow(t, {e2eFeedback: feedback, clearShippedPr: true})] : [id, t]
            )
        ),
        e2e_phase: {
            ...(s.e2e_phase ?? defaultE2ePhase()),
            status: undefined,
            reason: undefined,
            advisory: undefined,
            attempts,
            manifest, // already `run.e2e_phase?.manifest` (read at the top of this function) — s.e2e_phase can't have diverged since
            reopen_counts: reopenCounts,
        },
    }))
    log.info(`run '${runId}': e2e reopening task(s) ${taskIds.join(', ')} (pass ${attempts})`)
    return {kind: 'reopen', run_id: runId, task_ids: taskIds, reason: feedback}
}
