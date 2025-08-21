import { describe, it, expect, vi } from 'vitest';

import { signal } from '../signal.js';
import { computed } from '../computed.js';
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
    expect(s.get()).toBe(123);

    const obs = makeNode('effect');
    withObserver(obs, () => {
      expect(s.get()).toBe(123);
    });

    expect(obs.deps.size).toBe(1);
    const dep = [...obs.deps][0];
    expect(dep?.subs.has(obs)).toBe(true);
  });

  it('multiple get() within same observer is de-duped', () => {
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

describe('signal(set) -> schedules effects, marks computed stale', () => {
  it('schedules all effect subscribers', () => {
    const s = signal(0);

    const ef1 = makeNode('effect');
    const ef2 = makeNode('effect');
    const inst1 = attachEffectInstance(ef1);
    const inst2 = attachEffectInstance(ef2);

    const unsub1 = s.subscribe(ef1);
    const unsub2 = s.subscribe(ef2);

    s.set(1);

    expect(inst1.schedule).toHaveBeenCalledTimes(1);
    expect(inst2.schedule).toHaveBeenCalledTimes(1);

    unsub1(); unsub2();
  });

  it('marks downstream computed as stale (behavioral check, no spy)', () => {
    const s = signal(1);
    const c = computed(() => s.get() * 2);

    // 建立依賴（computed -> signal）
    expect(c.get()).toBe(2);
    expect(c._node.stale).toBe(false);

    // 改變 signal，應讓 c 變 stale
    s.set(5);
    expect(c._node.stale).toBe(true);

    // 下次讀取才會重算
    expect(c.get()).toBe(10);
    expect(c._node.stale).toBe(false);
  });

  it('updater form set(fn) works', () => {
    const s = signal(10);
    const ef = makeNode('effect');
    const inst = attachEffectInstance(ef);
    const unsub = s.subscribe(ef);

    s.set(prev => prev + 5); // 10 -> 15
    expect(s.get()).toBe(15);
    expect(inst.schedule).toHaveBeenCalledTimes(1);

    unsub();
  });

  it('custom equals prevents updates (no schedules, computed stays not-stale)', () => {
    const s = signal({ n: 1, x: 'a' }, (a, b) => a.n === b.n);

    const ef = makeNode('effect');
    const inst = attachEffectInstance(ef);
    const unsubEf = s.subscribe(ef);

    const c = computed(() => s.get(), (a, b) => a.n === b.n);
    c.get(); // 初始化，非 stale
    const wasStale = c._node.stale;

    s.set({ n: 1, x: 'changed' }); // equals:true -> 不更新
    expect(s.get()).toEqual({ n: 1, x: 'a' });
    expect(inst.schedule).not.toHaveBeenCalled();
    expect(c._node.stale).toBe(wasStale); // 不會被標髒

    unsubEf();
  });

  it('no subscribers: set() updates value and no throw', () => {
    const s = signal(1);
    expect(() => s.set(2)).not.toThrow();
    expect(s.get()).toBe(2);
  });

  it('multiple effects & computeds are all affected', () => {
    const s = signal(0);

    const effects = Array.from({ length: 2 }, () => makeNode('effect'));
    const insts = effects.map(n => attachEffectInstance(n));
    const computeds = Array.from({ length: 2 }, () => computed(() => s.get() + 1));

    const unsubs = [
      ...effects.map(n => s.subscribe(n)),
      // 讓每個 computed 建立依賴
      ...computeds.map(c => {
        c.get();
        // 讓 signal 知道這些 computed 是下游：由 computed.get() -> track -> link 建立
        return () => c.dispose();
      }),
    ];

    s.set(99);

    // effects 被 schedule
    insts.forEach(inst => expect(inst.schedule).toHaveBeenCalledTimes(1));
    // computeds 被標髒
    computeds.forEach(c => expect(c._node.stale).toBe(true));

    unsubs.forEach(u => u());
  });
});

describe('signal.subscribe(observer)', () => {
  it('links and returns unsubscribe', () => {
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
