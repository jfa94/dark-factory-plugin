/**
 * WS10 (holdout, Δ Y) — validation: deterministic scoring (anti-spoof), tolerant
 * parsing, prompt shape, and the gate-evidence mapping.
 */
import {describe, expect, it} from 'vitest'
import {makeHoldoutRecord} from './store.js'
import {
    buildHoldoutPrompt,
    checkHoldout,
    classifyHoldoutOutput,
    holdoutEvidence,
    parseHoldoutVerdicts,
    type HoldoutVerdict,
} from './validate.js'

const record = makeHoldoutRecord('task-1', ['criterion A', 'criterion B', 'criterion C'], 6)

describe('checkHoldout scoring', () => {
    it('passes when pass% ≥ threshold', () => {
        const verdicts: HoldoutVerdict[] = [
            {criterion: 'criterion A', satisfied: true, evidence: 'src/a.ts:1'},
            {criterion: 'criterion B', satisfied: true, evidence: 'src/b.ts:2'},
            {criterion: 'criterion C', satisfied: true, evidence: 'src/c.ts:3'},
        ]
        const r = checkHoldout(record, verdicts, 80)
        expect(r.status).toBe('pass')
        expect(r.satisfied).toBe(3)
        expect(r.passPct).toBe(100)
    })

    it('fails when pass% < threshold', () => {
        const verdicts: HoldoutVerdict[] = [
            {criterion: 'criterion A', satisfied: true, evidence: 'ok'},
            {criterion: 'criterion B', satisfied: false, evidence: 'missing'},
            {criterion: 'criterion C', satisfied: false, evidence: 'missing'},
        ]
        const r = checkHoldout(record, verdicts, 80)
        expect(r.status).toBe('fail')
        expect(r.satisfied).toBe(1)
        expect(r.passPct).toBe(33)
    })

    it('treats a missing verdict (short array) as a fail', () => {
        const r = checkHoldout(record, [{criterion: 'criterion A', satisfied: true, evidence: 'ok'}], 50)
        expect(r.satisfied).toBe(1) // only the first credited; B and C missing → fail
        expect(r.status).toBe('fail')
    })

    it('anti-spoof: positional text mismatch is NOT credited', () => {
        // Right index, wrong criterion text → must not count (a shuffled answer).
        const verdicts: HoldoutVerdict[] = [
            {criterion: 'criterion C', satisfied: true, evidence: 'ok'},
            {criterion: 'criterion A', satisfied: true, evidence: 'ok'},
            {criterion: 'criterion B', satisfied: true, evidence: 'ok'},
        ]
        const r = checkHoldout(record, verdicts, 1)
        expect(r.satisfied).toBe(0)
        expect(r.status).toBe('fail')
    })

    it('blank evidence is NOT credited even when satisfied=true', () => {
        const verdicts: HoldoutVerdict[] = [
            {criterion: 'criterion A', satisfied: true, evidence: '   '},
            {criterion: 'criterion B', satisfied: true, evidence: ''},
            {criterion: 'criterion C', satisfied: true, evidence: 'real'},
        ]
        const r = checkHoldout(record, verdicts, 1)
        expect(r.satisfied).toBe(1)
    })

    it('clamps a vacuous threshold (≤0) up to 1 — never auto-passes on 0 satisfied', () => {
        const allFail: HoldoutVerdict[] = record.withheld_criteria.map((c) => ({
            criterion: c,
            satisfied: false,
            evidence: '',
        }))
        const r = checkHoldout(record, allFail, 0)
        expect(r.threshold).toBe(1)
        expect(r.status).toBe('fail') // passPct 0 < 1
    })
})

describe('parseHoldoutVerdicts (tolerant extraction)', () => {
    const shape = {criteria: [{criterion: 'x', satisfied: true, evidence: 'e'}]}

    it('parses a bare JSON object', () => {
        expect(parseHoldoutVerdicts(JSON.stringify(shape))).toEqual([{criterion: 'x', satisfied: true, evidence: 'e'}])
    })

    it('parses a ```json fenced block wrapped in prose', () => {
        const raw = 'Here is my verdict:\n```json\n' + JSON.stringify(shape) + '\n```\nDone.'
        expect(parseHoldoutVerdicts(raw)).toEqual([{criterion: 'x', satisfied: true, evidence: 'e'}])
    })

    it('parses a prose-wrapped first{..}last} span', () => {
        const raw = 'blah ' + JSON.stringify(shape) + ' trailing'
        expect(parseHoldoutVerdicts(raw)).toEqual([{criterion: 'x', satisfied: true, evidence: 'e'}])
    })

    it('throws on malformed entry fields — never coerces them into domain verdicts', () => {
        const raw = JSON.stringify({criteria: [{criterion: 7, satisfied: 'yes', evidence: null}]})
        expect(() => parseHoldoutVerdicts(raw)).toThrow(/malformed/i)
    })

    it('throws (fail-loud) when no .criteria object is recoverable', () => {
        expect(() => parseHoldoutVerdicts('no json here')).toThrow(/no parseable/i)
        expect(() => parseHoldoutVerdicts(JSON.stringify({other: 1}))).toThrow(/no parseable/i)
    })
})

describe('classifyHoldoutOutput — malformed fields are evaluator failures, well-formed misses are verdicts', () => {
    const oneCriterion = makeHoldoutRecord('task-1', ['criterion A'], 3)
    const rawFor = (entry: Record<string, unknown>) => JSON.stringify({criteria: [entry]})

    it.each([
        ['satisfied: "yes"', {criterion: 'criterion A', satisfied: 'yes', evidence: 'src/x.ts:1'}],
        ['satisfied: 1', {criterion: 'criterion A', satisfied: 1, evidence: 'src/x.ts:1'}],
        ['satisfied: null', {criterion: 'criterion A', satisfied: null, evidence: 'src/x.ts:1'}],
        ['satisfied missing', {criterion: 'criterion A', evidence: 'src/x.ts:1'}],
        ['non-string criterion', {criterion: 7, satisfied: false, evidence: 'src/x.ts:1'}],
        ['non-string evidence', {criterion: 'criterion A', satisfied: false, evidence: null}],
    ])('matching criterion with %s is an evaluator failure, not a producer miss', (_name, entry) => {
        const out = classifyHoldoutOutput(oneCriterion, rawFor(entry))
        expect(out.kind).toBe('evaluator-failure')
    })

    it('well-formed satisfied:false — including blank evidence — remains a producer verdict', () => {
        const out = classifyHoldoutOutput(
            oneCriterion,
            rawFor({criterion: 'criterion A', satisfied: false, evidence: ''})
        )
        expect(out.kind).toBe('verdicts')
        if (out.kind !== 'verdicts') {
            throw new Error('unreachable')
        }
        expect(out.verdicts).toEqual([{criterion: 'criterion A', satisfied: false, evidence: ''}])
    })

    it('well-formed satisfied:true still requires nonblank evidence', () => {
        const out = classifyHoldoutOutput(
            oneCriterion,
            rawFor({criterion: 'criterion A', satisfied: true, evidence: '  '})
        )
        expect(out.kind).toBe('evaluator-failure')
    })
})

describe('buildHoldoutPrompt', () => {
    it('lists every withheld criterion and demands the strict shape', () => {
        const prompt = buildHoldoutPrompt(record)
        expect(prompt).toContain('task-1')
        expect(prompt).toContain('3 of 6 total')
        for (const c of record.withheld_criteria) {
            expect(prompt).toContain(c)
        }
        expect(prompt).toContain('"satisfied"')
        expect(prompt).toContain('missing entry is treated as a failure')
    })

    it('keys the worktree inspect command to the per-run base ref', () => {
        const prompt = buildHoldoutPrompt(record, '/wt/task-1', 'origin/staging-run-1')
        expect(prompt).toContain('/wt/task-1')
        // The task worktree forks from the per-run staging base (origin/staging-<run-id>),
        // never a bare `staging`/`origin/staging`, so the inspect command MUST diff THAT
        // ref — the bare ref namespace-collides after a repo-side branch rename.
        expect(prompt).toContain('git -C /wt/task-1 diff origin/staging-run-1')
        expect(prompt).not.toContain('diff staging')
    })

    it('throws fail-loud when a worktree is given without a base ref (Iron Law 3)', () => {
        expect(() => buildHoldoutPrompt(record, '/wt/task-1')).toThrow(/baseRef/i)
    })
})

describe('holdoutEvidence', () => {
    it('maps a pass to observed=true with an audit detail', () => {
        const ev = holdoutEvidence(
            checkHoldout(
                record,
                record.withheld_criteria.map((c) => ({criterion: c, satisfied: true, evidence: 'e'})),
                80
            )
        )
        expect(ev.gate).toBe('holdout')
        expect(ev.observed).toBe(true)
        expect(ev.detail).toContain('3/3')
    })

    it('maps a fail to observed=false', () => {
        const ev = holdoutEvidence(checkHoldout(record, [], 80))
        expect(ev.observed).toBe(false)
    })
})
