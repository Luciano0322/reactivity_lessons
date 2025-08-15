// computed.test.ts
import { describe, it, expect, vi } from 'vitest';

import { computed, markStale } from '../computed.js';
import {
  withObserver,
  track,
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

// 極簡 signal（只做 get/track，不做 set）
// 你可以用外部變數改它的 value，再用 markStale 傳染到 computed
function makeSignal<T>(initial: T) {
  const node = makeNode('signal');
  let value = initial;
  const get = () => {
    track(node);
    return value;
  };
  const set = (next: T) => {
    value = next;
  };
  return { node, get, set };
}

function attachEffectInstance(node: Node, impl?: Partial<EffectInstanceLike>) {
  const inst: EffectInstanceLike = { schedule: vi.fn(), ...impl } as EffectInstanceLike;
  SymbolRegistry.set(node, inst);
  return inst;
}

describe('computed: basic compute & dependency tracking', () => {
  it('first get() computes value and links deps (computed -> signal)', () => {
    const s = makeSignal(2);
    const c = computed(() => s.get() * 3);

    // 讀取會建立 computed → signal
    expect(c.get()).toBe(6);

    // 驗證依賴邊
    const node = c._node;
    expect(node.deps.has(s.node)).toBe(true);
    expect(s.node.subs.has(node)).toBe(true);
  });

  it('custom equals prevents updating cached value', () => {
    // comparator：只看 {n} 是否相同
    const s = makeSignal({ n: 1, x: 'a' });
    const c = computed(
      () => s.get(),
      (a, b) => a.n === b.n
    );

    const v1 = c.get(); // 第一次計算
    // 變更 source 但保持 n 相同 -> equals 為 true -> 不更新
    s.set({ n: 1, x: 'b' });
    markStale(c._node); // 模擬上游變動造成的髒化
    const v2 = c.get();

    expect(v2).toBe(v1); // 物件引用不變（未更新快取）
    expect(v2).toEqual({ n: 1, x: 'a' });
  });
});

describe('markStale: propagation to downstream computed and effect scheduling', () => {
  it('markStale(computed) sets stale flag and propagates to downstream computed; schedules effects', () => {
    const s = makeSignal(1);
    const c1 = computed(() => s.get() + 1);
    const c2 = computed(() => c1.get() * 10);

    // 建立一個訂閱 c2 的 effect
    const ef = makeNode('effect');
    const inst = attachEffectInstance(ef);

    // 讓 effect 依賴 c2
    withObserver(ef, () => {
      c2.get();
    });

    // 先確保初始皆非 stale
    expect(c1._node.stale).toBe(false);
    expect(c2._node.stale).toBe(false);

    // 對 c1 髒化 -> 傳染到 c2，且通知 effect 調度
    markStale(c1._node);

    expect(c1._node.stale).toBe(true);
    expect(c2._node.stale).toBe(true);
    expect(inst.schedule).toHaveBeenCalledTimes(1);
  });
});

describe('computed: recompute swaps deps (unlink old deps, link new deps)', () => {
  it('recomputing after source switch updates dep graph correctly', () => {
    const a = makeSignal(2);
    const b = makeSignal(5);

    let pickA = true;
    const c = computed(() => (pickA ? a.get() : b.get()) * 2);

    // 初次：依賴 a
    expect(c.get()).toBe(4);
    expect(c._node.deps.has(a.node)).toBe(true);
    expect(c._node.deps.has(b.node)).toBe(false);

    // 切換到 b，並髒化
    pickA = false;
    markStale(c._node);
    expect(c.get()).toBe(10);

    // 依賴應改為 b，且解除 a
    expect(c._node.deps.has(a.node)).toBe(false);
    expect(c._node.deps.has(b.node)).toBe(true);
    expect(a.node.subs.has(c._node)).toBe(false);
    expect(b.node.subs.has(c._node)).toBe(true);
  });
});

describe('computed: peek() does not track nor recompute', () => {
  it('peek returns cached value without tracking; does not recompute even if stale', () => {
    const s = makeSignal(3);
    const c = computed(() => s.get() + 1);

    // 先算一次
    expect(c.get()).toBe(4);

    // 髒化，但用 peek 讀
    markStale(c._node);
    const spy = vi.spyOn(c as any, '_node', 'get'); // 不真能攔 recompute；改以圖邊/值驗證
    const v = c.peek();
    expect(v).toBe(4); // 未重算，仍是舊值

    // 用 observer 去讀 peek() 不應建邊
    const obs = makeNode('computed');
    withObserver(obs, () => {
      const _ = c.peek();
    });
    expect(obs.deps.size).toBe(0); // 沒有追蹤
    spy.mockRestore?.();
  });
});

describe('computed: dispose()', () => {
  it('clears deps and subs; resets flags', () => {
    const s = makeSignal(2);
    const c = computed(() => s.get() * 2);

    // 建立下游訂閱者（effect）
    const ef = makeNode('effect');
    attachEffectInstance(ef);
    withObserver(ef, () => {
      c.get();
    });

    // 確認目前圖邊
    expect(c._node.deps.has(s.node)).toBe(true);
    expect(s.node.subs.has(c._node)).toBe(true);
    expect(ef.deps.has(c._node)).toBe(true);
    expect(c._node.subs.has(ef)).toBe(true);

    // dispose
    c.dispose();

    // 上下游連結都應清乾淨
    expect(c._node.deps.size).toBe(0);
    expect(c._node.subs.size).toBe(0);
    expect(s.node.subs.has(c._node)).toBe(false);
    expect(ef.deps.has(c._node)).toBe(false);

    // 旗標 reset
    expect(c._node.stale).toBe(true);
    expect(c._node.hasValue).toBe(false);
  });
});

describe('computed: tracking by other observers via get()', () => {
  it('get() inside withObserver links observer -> computed', () => {
    const s = makeSignal(1);
    const c = computed(() => s.get() + 1);
    const obs = makeNode('effect');
    attachEffectInstance(obs);

    withObserver(obs, () => {
      expect(c.get()).toBe(2);
    });

    expect(obs.deps.has(c._node)).toBe(true);
    expect(c._node.subs.has(obs)).toBe(true);
  });
});

describe('computed: cycle detection', () => {
  it('throws "Cycle detected in computed" when computed depends on itself through another computed', () => {
    // A 依賴 B；B 又依賴 A -> 讀 A 時重算遇到 A.computing 為 true 應丟錯
    let a!: ReturnType<typeof computed<number>>;
    let b!: ReturnType<typeof computed<number>>;

    a = computed(() => (b ? b.get() + 1 : 0));
    b = computed(() => (a ? a.get() + 1 : 0));

    expect(() => a.get()).toThrowError(/Cycle detected in computed/);
  });
});
