// signal-with-markStale.test.ts
import { describe, it, expect, vi } from 'vitest';

import { signal } from '../signal.js';
import * as computedMod from '../computed.js';
import {
  withObserver,
  type Node,
  type Kind,
} from '../graph.js';
import {
  SymbolRegistry,
  type EffectInstanceLike,
} from '../registry.js';

/** Helpers */
function makeNode(kind: Kind): Node {
  return { kind, deps: new Set<Node>(), subs: new Set<Node>() };
}

function attachEffectInstance(node: Node, impl?: Partial<EffectInstanceLike>) {
  const inst: EffectInstanceLike = { schedule: vi.fn(), ...impl } as EffectInstanceLike;
  SymbolRegistry.set(node, inst);
  return inst;
}

describe('signal(get)', () => {
  it('returns current value; inside withObserver it tracks dependency (observer -> signal)', () => {
    const s = signal(123);

    // 非觀察者環境：只取值
    expect(s.get()).toBe(123);

    const obs = makeNode('effect');
    withObserver(obs, () => {
      expect(s.get()).toBe(123);
    });

    // 追蹤建邊（observer -> signal）
    expect(obs.deps.size).toBe(1);
    const dep = [...obs.deps][0];
    expect(dep?.subs.has(obs)).toBe(true);
  });

  it('multiple get() within the same observer does not duplicate edges (Set de-dupe)', () => {
    const s = signal('x');
    const obs = makeNode('computed');

    withObserver(obs, () => {
      s.get();
      s.get();
      s.get();
    });

    expect(obs.deps.size).toBe(1);
    const dep = [...obs.deps][0];
    expect(dep?.subs.size).toBe(1);
  });
});

describe('signal(set) -> schedules effects, marks computed as stale', () => {
  it('value change schedules all effect subscribers and calls markStale for computed subscribers', () => {
    const s = signal(0);

    // 兩個 effect 訂閱者
    const ef1 = makeNode('effect');
    const ef2 = makeNode('effect');
    const inst1 = attachEffectInstance(ef1);
    const inst2 = attachEffectInstance(ef2);

    // 一個 computed 訂閱者
    const c = makeNode('computed');
    // 為了驗證 markStale 被呼叫
    const staleSpy = vi.spyOn(computedMod, 'markStale');

    // 顯式訂閱（三個下游）
    const unsub1 = s.subscribe(ef1);
    const unsub2 = s.subscribe(ef2);
    const unsub3 = s.subscribe(c);

    s.set(1);

    // effects -> schedule()
    expect(inst1.schedule).toHaveBeenCalledTimes(1);
    expect(inst2.schedule).toHaveBeenCalledTimes(1);

    // computed -> markStale 被呼叫一次，參數即 c
    expect(staleSpy).toHaveBeenCalledTimes(1);
    expect(staleSpy).toHaveBeenCalledWith(c);

    unsub1(); unsub2(); unsub3();
    staleSpy.mockRestore();
  });

  it('updater form set(fn) works and triggers schedules/marking when value changes', () => {
    const s = signal(10);
    const ef = makeNode('effect');
    const inst = attachEffectInstance(ef);
    const c = makeNode('computed');
    const staleSpy = vi.spyOn(computedMod, 'markStale');

    const unsubEf = s.subscribe(ef);
    const unsubC = s.subscribe(c);

    s.set(prev => prev + 5); // 10 -> 15

    expect(s.get()).toBe(15);
    expect(inst.schedule).toHaveBeenCalledTimes(1);
    expect(staleSpy).toHaveBeenCalledTimes(1);
    expect(staleSpy).toHaveBeenCalledWith(c);

    unsubEf(); unsubC();
    staleSpy.mockRestore();
  });

  it('custom equals prevents updates, thus no schedule and no markStale', () => {
    // comparator：只看 n 欄位是否相同
    const s = signal({ n: 1, x: 'a' }, (a, b) => a.n === b.n);

    const ef = makeNode('effect');
    const inst = attachEffectInstance(ef);
    const c = makeNode('computed');
    const staleSpy = vi.spyOn(computedMod, 'markStale');

    const u1 = s.subscribe(ef);
    const u2 = s.subscribe(c);

    // n 相同 -> equals 為真 -> 不更新、不調度、不髒化
    s.set({ n: 1, x: 'changed' });

    expect(s.get()).toEqual({ n: 1, x: 'a' });
    expect(inst.schedule).not.toHaveBeenCalled();
    expect(staleSpy).not.toHaveBeenCalled();

    u1(); u2();
    staleSpy.mockRestore();
  });

  it('no subscribers: set() should not throw and still update value', () => {
    const s = signal(1);
    expect(() => s.set(2)).not.toThrow();
    expect(s.get()).toBe(2);
  });

  it('multiple effect & computed subscribers all get scheduled/marked on change', () => {
    const s = signal(0);

    const effects = Array.from({ length: 3 }, () => makeNode('effect'));
    const insts = effects.map(n => attachEffectInstance(n));
    const computeds = Array.from({ length: 2 }, () => makeNode('computed'));
    const staleSpy = vi.spyOn(computedMod, 'markStale');

    const unsubs = [
      ...effects.map(n => s.subscribe(n)),
      ...computeds.map(n => s.subscribe(n)),
    ];

    s.set(99);

    insts.forEach(inst => expect(inst.schedule).toHaveBeenCalledTimes(1));
    expect(staleSpy).toHaveBeenCalledTimes(computeds.length);
    computeds.forEach(c => {
      expect(staleSpy).toHaveBeenCalledWith(c);
    });

    unsubs.forEach(u => u());
    staleSpy.mockRestore();
  });
});

describe('signal.subscribe(observer)', () => {
  it('links observer -> signal and returns an unsubscribe function', () => {
    const s = signal('hi');
    const obs = makeNode('effect');

    const unsub = s.subscribe(obs);
    expect(obs.deps.size).toBe(1);
    const dep = [...obs.deps][0];
    expect(dep?.subs.has(obs)).toBe(true);

    unsub();
    expect(obs.deps.size).toBe(0);
    expect(dep?.subs.has(obs)).toBe(false);
  });

  it('throws if observer is a signal', () => {
    const s = signal(0);
    const sigObs = makeNode('signal');
    expect(() => s.subscribe(sigObs)).toThrow(/A signal cannot subscribe to another node/);
  });
});
