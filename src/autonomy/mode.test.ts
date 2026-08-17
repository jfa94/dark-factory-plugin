import {describe, expect, it} from 'vitest'

import {isAutonomous, NotAutonomousError, requireAutonomousMode} from './mode.js'

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
        expect(message).toContain('factory autonomy status')
    })
})
