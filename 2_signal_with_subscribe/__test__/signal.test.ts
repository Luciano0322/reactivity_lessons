// signal.test.ts
import { describe, it, expect } from 'vitest';
import { signal } from '../signal.js';
import {
  type Node,
  type Kind,
  withObserver,
} from '../graph.js';

function makeNode(kind: Kind): Node {
  return {
    kind,
    deps: new Set<Node>(),
    subs: new Set<Node>(),
  };
}

describe('signal(get/set)', () => {
  it('get() returns initial value', () => {
    const s = signal(123);
    expect(s.get()).toBe(123);
  });

  it('set(next) updates value when not equal', () => {
    const s = signal({ n: 1 }, (a, b) => a.n === b.n);
    s.set({ n: 2 });
    expect(s.get()).toEqual({ n: 2 });
  });

  it('custom equals prevents update when considered equal', () => {
    // 自訂 comparator：只看數字是否同奇偶
    const s = signal(2, (a, b) => (a % 2) === (b % 2));
    // 3 與 2 被視為「同一類」(偶/奇相同? 這裡是不同：為了測 no-op，改成 4)
    s.set(4); // 同為偶數 => 應被視為 equal -> 不更新
    expect(s.get()).toBe(2);
  });
});

describe('signal + track (withObserver)', () => {
  it('calling get() inside withObserver creates an edge observer -> signal', () => {
    const obs = makeNode('effect');
    const s = signal(1);

    withObserver(obs, () => {
      // 讀取時會 track(s 的 node)
      s.get();
    });

    // 由於 Set 去重，deps 應只有一個
    expect(obs.deps.size).toBe(1);
    // 反向鏈也只會有一個（signal node -> subs 會含 obs）
    const dep = [...obs.deps][0];
    expect(dep?.subs.has(obs)).toBe(true);
  });

  it('multiple get() calls are idempotent (no duplicate edges)', () => {
    const obs = makeNode('computed');
    const s = signal('x');

    withObserver(obs, () => {
      s.get();
      s.get();
      s.get();
    });

    expect(obs.deps.size).toBe(1);
    const dep = [...obs.deps][0];
    expect(dep?.subs.size).toBe(1);
  });

  it('nested withObserver restores previous observer', () => {
    const outer = makeNode('effect');
    const inner = makeNode('computed');
    const s1 = signal('a');
    const s2 = signal('b');

    withObserver(outer, () => {
      s1.get(); // outer -> s1

      withObserver(inner, () => {
        s2.get(); // inner -> s2
      });

      s1.get(); // 回到 outer，仍只影響 outer -> s1
    });

    // outer 只依賴 s1
    expect(outer.deps.size).toBe(1);
    const outerDep = [...outer.deps][0];
    expect(s1.get()).toBe('a'); // 只是確保 s1 存在
    expect(outerDep?.subs.has(outer)).toBe(true);

    // inner 只依賴 s2
    expect(inner.deps.size).toBe(1);
    const innerDep = [...inner.deps][0];
    expect(s2.get()).toBe('b');
    expect(innerDep?.subs.has(inner)).toBe(true);
  });
});

describe('signal.subscribe(observer)', () => {
  it('subscribe links observer -> signal and returns an unsubscribe function', () => {
    const obs = makeNode('effect');
    const s = signal(0);

    const unsubscribe = s.subscribe(obs);

    // 立即建立邊
    expect(obs.deps.size).toBe(1);
    const dep = [...obs.deps][0];
    expect(dep?.subs.has(obs)).toBe(true);

    // 取消訂閱
    unsubscribe();
    expect(obs.deps.size).toBe(0);
    expect(dep?.subs.has(obs)).toBe(false);
  });

  it('throws if observer is a signal', () => {
    const sigObserver = makeNode('signal'); // signal 不可作為 observer
    const s = signal(0);

    expect(() => s.subscribe(sigObserver)).toThrowError(
      /A signal cannot subscribe to another node/
    );
  });
});
