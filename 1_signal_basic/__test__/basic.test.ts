import { describe, it, expect } from 'vitest'
import { signal } from '../basic.js'

describe('signal()', () => {
  it('returns initial value via get() and can set() a new primitive', () => {
    const count = signal(1)
    expect(count.get()).toBe(1)

    count.set(2)
    expect(count.get()).toBe(2)
  })

  it('supports updater form set((prev) => next)', () => {
    const s = signal(10)
    s.set((prev) => prev + 5)
    expect(s.get()).toBe(15)

    s.set((prev) => prev * 2)
    expect(s.get()).toBe(30)
  })

  it('uses Object.is semantics (handles -0 and NaN as expected)', () => {
    const z = signal(0)
    z.set(-0)
    // Object.is(0, -0) === false → 會更新為 -0
    expect(Object.is(z.get(), -0)).toBe(true)

    const n = signal(1)
    n.set(Number.NaN)
    expect(Number.isNaN(n.get())).toBe(true)
    // 再設為 NaN（Object.is(NaN, NaN) === true）不應有變化（外部觀察仍為 NaN）
    n.set(Number.NaN)
    expect(Number.isNaN(n.get())).toBe(true)
  })

  it('does not change reference when setting the same object (Object.is === true)', () => {
    const obj = { a: 1 }
    const s = signal(obj)

    s.set(obj) // 相同參考，Object.is(true) → 不更新
    expect(s.get()).toBe(obj)
  })

  it('can replace object reference and supports updater that returns a new object', () => {
    const s = signal({ a: 1 })

    // 以新物件取代
    const next = { a: 2 }
    s.set(next)
    expect(s.get()).toEqual({ a: 2 })
    expect(s.get()).toBe(next) // 參考已變更

    // 以 updater 產生新物件
    s.set((prev) => ({ ...prev, a: prev.a + 1 }))
    expect(s.get()).toEqual({ a: 3 })
  })
})
