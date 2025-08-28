import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// ---- 模組 mock（要在 import 被測模組「之前」宣告）----
vi.mock('../src/core/computed.js', () => {
  return {
    markStale: vi.fn(), // 供斷言是否被呼叫
  };
});

vi.mock('../src/core/scheduler.js', () => {
  // inAtomic 可由測試動態切換；recordAtomicWrite 作為 spy
  const inAtomicFlag = { value: false };
  const recordAtomicWrite = vi.fn();

  return {
    inAtomic: vi.fn(() => inAtomicFlag.value),
    recordAtomicWrite,
    // 曝露可讓測試切換 inAtomic 值
    __setInAtomic(v: boolean) { inAtomicFlag.value = v; },
  };
});

// registry 用真實實作（我們只需要 set/get），不需要 mock
// graph 也用真實實作（link/unlink/withObserver/track）
import { SymbolRegistry } from '../src/core/registry.js';
import { withObserver, type Node, type Kind } from '../src/core/graph.js';

// 被測模組：在 mocks 宣告後再 import
import { signal } from '../src/core/signal.js';
import * as computedMod from '../src/core/computed.js';
import * as schedulerMod from '../src/core/scheduler.js';

// --------- Helpers ----------
function makeNode(kind: Kind): Node {
  return { kind, deps: new Set<Node>(), subs: new Set<Node>() };
}
function attachEffectInstance(node: Node, impl?: Partial<{ schedule: () => void }>) {
  const inst = { schedule: vi.fn(), ...impl };
  SymbolRegistry.set(node, inst as any);
  return inst;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ================== 測試 ==================
describe('signal(get) tracking', () => {
  it('get() 在觀察者環境中會建邊（observer -> signal）', () => {
    const s = signal(123);

    // 非觀察者環境：單純取值
    expect(s.get()).toBe(123);

    const obs = makeNode('effect');
    withObserver(obs, () => {
      expect(s.get()).toBe(123);
    });

    // 追蹤建邊（observer -> signal）
    expect(obs.deps.size).toBe(1);
    const dep = [...obs.deps][0]!;
    expect(dep.subs.has(obs)).toBe(true);
  });

  it('同一觀察者多次 get() 不會重複建邊（Set 去重）', () => {
    const s = signal('x');
    const obs = makeNode('computed');

    withObserver(obs, () => {
      s.get();
      s.get();
      s.get();
    });

    expect(obs.deps.size).toBe(1);
    const dep = [...obs.deps][0]!;
    expect(dep.subs.size).toBe(1);
  });
});

describe('signal(set): schedules/markStale + equals + atomic hooks', () => {
  it('value 變更：所有 effect 訂閱者被 schedule，所有 computed 訂閱者被 markStale', () => {
    const s = signal(0);

    // 兩個 effect 訂閱者
    const ef1 = makeNode('effect');
    const ef2 = makeNode('effect');
    const inst1 = attachEffectInstance(ef1);
    const inst2 = attachEffectInstance(ef2);

    // 一個 computed 訂閱者
    const c = makeNode('computed');
    const staleSpy = computedMod.markStale as unknown as Mock;

    // 顯式訂閱三個下游
    const u1 = s.subscribe(ef1);
    const u2 = s.subscribe(ef2);
    const u3 = s.subscribe(c);

    s.set(1);

    expect(inst1.schedule).toHaveBeenCalledTimes(1);
    expect(inst2.schedule).toHaveBeenCalledTimes(1);
    expect(staleSpy).toHaveBeenCalledTimes(1);
    expect(staleSpy).toHaveBeenCalledWith(c);

    u1(); u2(); u3();
  });

  it('custom equals：相等時不更新、不 schedule、不 markStale', () => {
    const s = signal({ n: 1, x: 'a' }, (a, b) => a.n === b.n);

    const ef = makeNode('effect');
    const inst = attachEffectInstance(ef);

    const c = makeNode('computed');
    const staleSpy = computedMod.markStale as unknown as Mock;

    const u1 = s.subscribe(ef);
    const u2 = s.subscribe(c);

    s.set({ n: 1, x: 'changed' }); // equals 為真 → 不更新

    expect(inst.schedule).not.toHaveBeenCalled();
    expect(staleSpy).not.toHaveBeenCalled();
    expect(s.get()).toEqual({ n: 1, x: 'a' });

    u1(); u2();
  });

  it('沒有訂閱者：set() 仍更新值但不拋錯', () => {
    const s = signal(1);
    expect(() => s.set(2)).not.toThrow();
    expect(s.get()).toBe(2);
  });

  it('inAtomic() 為真時，寫入前會以舊值呼叫 recordAtomicWrite(node, prev)', () => {
    // 開啟 atomic 模式
    (schedulerMod as any).__setInAtomic(true);

    const s = signal(10);
    const recSpy = schedulerMod.recordAtomicWrite as unknown as Mock;

    // 第一次變更：prev 應是 10
    s.set(11);
    expect(recSpy).toHaveBeenCalledTimes(1);
    expect(recSpy).toHaveBeenNthCalledWith(1, expect.anything(), 10);

    // 再次變更：prev 應是 11（實際「只記錄首見」的去重邏輯由 recordAtomicWrite 內部負責；
    // 這裡只驗證 signal 在 inAtomic 下會以當下舊值呼叫它）
    s.set(12);
    expect(recSpy).toHaveBeenCalledTimes(2);
    expect(recSpy).toHaveBeenNthCalledWith(2, expect.anything(), 11);

    // 關閉 atomic
    (schedulerMod as any).__setInAtomic(false);
  });
});

describe('signal.subscribe', () => {
  it('links observer → signal，且回傳 unsubscribe 可解除連結', () => {
    const s = signal('hi');
    const obs = makeNode('effect');

    const unsub = s.subscribe(obs);
    expect(obs.deps.size).toBe(1);
    const dep = [...obs.deps][0]!;
    expect(dep.subs.has(obs)).toBe(true);

    unsub();
    expect(obs.deps.size).toBe(0);
    expect(dep.subs.has(obs)).toBe(false);
  });

  it('observer 若是 signal 則丟錯', () => {
    const s = signal(0);
    const sigObs = makeNode('signal');
    expect(() => s.subscribe(sigObs)).toThrow(/A signal cannot subscribe to another node/);
  });
});
