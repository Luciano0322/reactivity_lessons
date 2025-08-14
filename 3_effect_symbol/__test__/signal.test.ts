import { describe, it, expect, vi } from 'vitest';

import { signal } from '../signal.js';
import {
  withObserver,
  type Node,
  type Kind,
} from '../graph.js';
import {
  SymbolRegistry,
  type EffectInstanceLike,
} from '../registry.js';

function makeNode(kind: Kind): Node {
  return { kind, deps: new Set<Node>(), subs: new Set<Node>() };
}

function attachEffectInstance(node: Node, impl?: Partial<EffectInstanceLike>) {
  const inst: EffectInstanceLike = {
    schedule: vi.fn(),
    ...impl,
  } as EffectInstanceLike;
  SymbolRegistry.set(node, inst);
  return inst;
}

describe('signal(get/set/subscribe) with scheduling', () => {
  it('get() returns value and tracks dependency only in observer context', () => {
    const s = signal(1);

    // 沒有 observer 時，不建邊
    expect(s.get()).toBe(1);

    // 在 observer 內部讀取會建立 observer -> signal 連結
    const obs = makeNode('effect');
    withObserver(obs, () => {
      expect(s.get()).toBe(1);
    });

    expect(obs.deps.size).toBe(1);
    const dep = [...obs.deps][0];
    expect(dep?.subs.has(obs)).toBe(true);
  });

  it('set(next) with value changed triggers schedule() on effect subscribers', () => {
    const s = signal(0);

    // 兩個 effect 訂閱者
    const ef1 = makeNode('effect');
    const ef2 = makeNode('effect');
    const inst1 = attachEffectInstance(ef1);
    const inst2 = attachEffectInstance(ef2);

    // 一個非 effect 訂閱者（例如 computed），不應被 schedule
    const cmp = makeNode('computed');

    // 以顯式 subscribe 建邊
    const unsub1 = s.subscribe(ef1);
    const unsub2 = s.subscribe(ef2);
    const unsub3 = s.subscribe(cmp);

    // 變更值 -> 觸發 effect 的 schedule
    s.set(1);
    expect(inst1.schedule).toHaveBeenCalledTimes(1);
    expect(inst2.schedule).toHaveBeenCalledTimes(1);

    // computed 訂閱者不會呼叫 schedule
    // （沒有 instance 附掛也不會 throw）
    // 解除訂閱避免互相污染
    unsub1();
    unsub2();
    unsub3();
  });

  it('set(next) no-op when equals returns true (no schedule)', () => {
    // 自訂 comparator：只看 n 欄位
    const s = signal({ n: 1, x: 'a' }, (a, b) => a.n === b.n);

    const ef = makeNode('effect');
    const inst = attachEffectInstance(ef);
    const unsub = s.subscribe(ef);

    // n 相同 -> 視為相等 -> 不更新、不 schedule
    s.set({ n: 1, x: 'changed' });
    expect(s.get()).toEqual({ n: 1, x: 'a' }); // 值未變
    expect(inst.schedule).not.toHaveBeenCalled();

    // n 改變 -> 更新並 schedule
    s.set({ n: 2, x: 'anything' });
    expect(s.get()).toEqual({ n: 2, x: 'anything' });
    expect(inst.schedule).toHaveBeenCalledTimes(1);

    unsub();
  });

  it('set(fn) updater form works and triggers schedule when changed', () => {
    const s = signal(10);
    const ef = makeNode('effect');
    const inst = attachEffectInstance(ef);
    const unsub = s.subscribe(ef);

    s.set(prev => prev + 5); // 10 -> 15
    expect(s.get()).toBe(15);
    expect(inst.schedule).toHaveBeenCalledTimes(1);

    unsub();
  });

  it('subscribe() links observer -> signal and returns an unsubscribe function', () => {
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

  it('subscribe() throws if observer is a signal', () => {
    const s = signal(0);
    const sigObs = makeNode('signal');

    expect(() => s.subscribe(sigObs)).toThrowError(
      /A signal cannot subscribe to another node/
    );
  });

  it('multiple effect subscribers all get scheduled on change', () => {
    const s = signal(0);
    const efs = Array.from({ length: 3 }, () => makeNode('effect'));
    const insts = efs.map(n => attachEffectInstance(n));
    const unsubs = efs.map(n => s.subscribe(n));

    s.set(42);

    insts.forEach(inst => expect(inst.schedule).toHaveBeenCalledTimes(1));

    unsubs.forEach(u => u());
  });

  it('no subscribers -> set() should not throw', () => {
    const s = signal(0);
    expect(() => s.set(1)).not.toThrow();
    expect(s.get()).toBe(1);
  });

  it('idempotent tracking via Set: multiple get() in same observer does not duplicate edges', () => {
    const s = signal('x');
    const obs = makeNode('effect');

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
