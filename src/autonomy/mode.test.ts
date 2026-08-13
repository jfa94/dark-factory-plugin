import {describe, expect, it} from 'vitest'

import {decideAutonomyPreflight, isAutonomous, NotAutonomousError, requireAutonomousMode} from './mode.js'

describe('isAutonomous', () => {
    it("is true only when FACTORY_AUTONOMOUS_MODE is exactly '1'", () => {
        expect(isAutonomous({FACTORY_AUTONOMOUS_MODE: '1'})).toBe(true)
    })

    it('is false when the var is unset', () => {
        expect(isAutonomous({})).toBe(false)
    })

    it('is false for any other truthy-looking value (no bypass)', () => {
        expect(isAutonomous({FACTORY_AUTONOMOUS_MODE: 'true'})).toBe(false)
        expect(isAutonomous({FACTORY_AUTONOMOUS_MODE: '0'})).toBe(false)
        expect(isAutonomous({FACTORY_AUTONOMOUS_MODE: ''})).toBe(false)
        expect(isAutonomous({FACTORY_AUTONOMOUS_MODE: ' 1'})).toBe(false)
    })
})

describe('requireAutonomousMode', () => {
    it('returns void without throwing when autonomous', () => {
        expect(() => {
            requireAutonomousMode({FACTORY_AUTONOMOUS_MODE: '1'})
        }).not.toThrow()
    })

    it('throws NotAutonomousError when not autonomous', () => {
        expect(() => {
            requireAutonomousMode({})
        }).toThrow(NotAutonomousError)
    })

    it('names the actionable recovery path in the halt message', () => {
        let caught: unknown
        try {
            requireAutonomousMode({})
        } catch (err) {
            caught = err
        }
        expect(caught).toBeInstanceOf(NotAutonomousError)
        const message = (caught as Error).message
        expect(message).toContain('factory autonomy ensure')
        expect(message).toContain('claude --settings')
    })
})

describe('decideAutonomyPreflight', () => {
    it('not autonomous + no file → halt + regenerate (missing-settings)', () => {
        expect(
            decideAutonomyPreflight({
                autonomous: false,
                mergedSettingsPresent: false,
                expectedHash: 'aaa',
                storedHash: undefined,
            })
        ).toEqual({proceed: false, regenerate: true, reason: 'missing-settings'})
    })

    it('not autonomous + file present → halt + regenerate (not-autonomous)', () => {
        expect(
            decideAutonomyPreflight({
                autonomous: false,
                mergedSettingsPresent: true,
                expectedHash: 'aaa',
                storedHash: 'aaa',
            })
        ).toEqual({proceed: false, regenerate: true, reason: 'not-autonomous'})
    })

    it('autonomous + no file → proceed without regenerate (ci-raw-env)', () => {
        expect(
            decideAutonomyPreflight({
                autonomous: true,
                mergedSettingsPresent: false,
                expectedHash: 'aaa',
                storedHash: undefined,
            })
        ).toEqual({proceed: true, regenerate: false, reason: 'ci-raw-env'})
    })

    it('autonomous + file + hashes differ → halt + regenerate (stale-settings)', () => {
        expect(
            decideAutonomyPreflight({
                autonomous: true,
                mergedSettingsPresent: true,
                expectedHash: 'aaa',
                storedHash: 'bbb',
            })
        ).toEqual({proceed: false, regenerate: true, reason: 'stale-settings'})
    })

    it('autonomous + file + hashes equal → proceed without regenerate (fresh)', () => {
        expect(
            decideAutonomyPreflight({
                autonomous: true,
                mergedSettingsPresent: true,
                expectedHash: 'aaa',
                storedHash: 'aaa',
            })
        ).toEqual({proceed: true, regenerate: false, reason: 'fresh'})
    })

    it('autonomous + file present but unstamped → halt + regenerate (unstamped)', () => {
        expect(
            decideAutonomyPreflight({
                autonomous: true,
                mergedSettingsPresent: true,
                expectedHash: 'aaa',
                storedHash: undefined,
            })
        ).toEqual({proceed: false, regenerate: true, reason: 'unstamped'})
    })

    it('autonomous + file + expected hash unknowable → proceed without regenerate (hash-unknowable)', () => {
        expect(
            decideAutonomyPreflight({
                autonomous: true,
                mergedSettingsPresent: true,
                expectedHash: undefined,
                storedHash: 'aaa',
            })
        ).toEqual({proceed: true, regenerate: false, reason: 'hash-unknowable'})
    })

    it('invariant: regenerate === true ⟹ proceed === false (across the whole input space)', () => {
        const bools = [true, false]
        const hashes: (string | undefined)[] = [undefined, 'aaa', 'bbb']
        for (const autonomous of bools) {
            for (const mergedSettingsPresent of bools) {
                for (const expectedHash of hashes) {
                    for (const storedHash of hashes) {
                        const decision = decideAutonomyPreflight({
                            autonomous,
                            mergedSettingsPresent,
                            expectedHash,
                            storedHash,
                        })
                        if (decision.regenerate) {
                            expect(decision.proceed).toBe(false)
                        }
                    }
                }
            }
        }
    })
})
