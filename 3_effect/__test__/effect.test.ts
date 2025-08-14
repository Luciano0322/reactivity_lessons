// effect-instance.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  EffectInstance,
  createEffect,
  onCleanup,
} from '../effect.js';
import {
  withObserver,
  track,
  type Node,
  type Kind,
} from '../graph.js';
import {
  SymbolRegistry,
} from '../registry.js';

function makeNode(kind: Kind): Node {
  return { kind, deps: new Set<Node>(), subs: new Set<Node>() };
}

describe('EffectInstance: basic run & dependency tracking', () => {
  it('collects deps on first run and swaps deps on subsequent run', () => {
    const dep1 = makeNode('signal');
    const dep2 = makeNode('signal');

    let which = 1;
    const ef = new EffectInstance(() => {
      track(which === 1 ? dep1 : dep2);
    });

    // first run by hand (constructor 不會自動 run)
    ef.run();
    expect(ef.node.deps.has(dep1)).toBe(true);
    expect(ef.node.deps.has(dep2)).toBe(false);
    expect(dep1.subs.has(ef.node)).toBe(true);

    // switch to dep2 and run again -> 舊依賴 dep1 應解除、改為 dep2
    which = 2;
    ef.run();
    expect(ef.node.deps.has(dep1)).toBe(false);
    expect(ef.node.deps.has(dep2)).toBe(true);
    expect(dep1.subs.has(ef.node)).toBe(false);
    expect(dep2.subs.has(ef.node)).toBe(true);
  });

  it('registers itself into SymbolRegistry on construction and removes on dispose', () => {
    const ef = new EffectInstance(() => {});
    // 尚未 run 也已經註冊
    expect(SymbolRegistry.get(ef.node)).toBe(ef);
    ef.dispose();
    expect(SymbolRegistry.get(ef.node)).toBeUndefined();
  });

  it('is a no-op to dispose twice', () => {
    const ef = new EffectInstance(() => {});
    ef.dispose();
    expect(() => ef.dispose()).not.toThrow();
  });
});

describe('EffectInstance: cleanup handling (LIFO) & returned cleanup', () => {
  it('executes prior cleanups in LIFO order before next run', () => {
    const calls: number[] = [];

    const ef = new EffectInstance(() => {
      onCleanup(() => calls.push(1));
      onCleanup(() => calls.push(2));
    });

    ef.run();        // 收集兩個 cleanups
    ef.run();        // 先清理，再執行（不再新增 cleanup）
    expect(calls).toEqual([2, 1]); // LIFO
  });

  it('supports function returned by effect as a cleanup', () => {
    const calls: string[] = [];
    const ef = new EffectInstance(() => {
      return () => calls.push('ret');
    });

    ef.run(); // 第一次 run 會收集返回值 cleanup，但不執行
    expect(calls).toEqual([]);

    ef.run(); // 第二次 run 前會執行上一次收集到的 cleanup
    expect(calls).toEqual(['ret']);

    ef.dispose(); // dispose 時若還有 cleanups 也會被清理
    // 再次 dispose 不應丟錯
    expect(() => ef.dispose()).not.toThrow();
  });

  it('dispose clears cleanups and unlinks deps', () => {
    const dep = makeNode('signal');
    let cleared = 0;

    const ef = new EffectInstance(() => {
      track(dep);
      onCleanup(() => {
        cleared++;
      });
    });

    ef.run();      // 收集 dep 與 cleanup
    expect(ef.node.deps.has(dep)).toBe(true);

    ef.dispose();  // 應清理與解除 dep
    expect(cleared).toBe(1);
    expect(ef.node.deps.size).toBe(0);
    expect(dep.subs.has(ef.node)).toBe(false);
  });
});

describe('EffectInstance: scheduling (microtask batching)', () => {
  it('batches multiple schedule() calls in the same tick into a single run per instance', async () => {
    const spyRuns: number[] = [];

    const ef = new EffectInstance(() => { spyRuns.push(1); });
    // spy run method to count invocations of run() itself (optional)
    const runSpy = vi.spyOn(ef, 'run');

    // schedule 多次，應該在一次 microtask flush 時只跑一次
    ef.schedule();
    ef.schedule();
    ef.schedule();

    // 等待 microtask（queueMicrotask）
    await Promise.resolve();
    await Promise.resolve();

    // Effect function 應該被執行一次；run() 也只呼叫一次
    expect(spyRuns.length).toBe(1);
    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it('does not execute scheduled effect if disposed before microtask flush', async () => {
    let executed = 0;
    const ef = new EffectInstance(() => { executed++; });

    ef.schedule();
    ef.dispose();

    await Promise.resolve();
    await Promise.resolve();

    // run() 可能有被呼叫，但 effect 本體不應執行（因為 run() 開頭就 return）
    expect(executed).toBe(0);
  });

  it('createEffect runs once immediately and returns a disposer', () => {
    let count = 0;
    const dispose = createEffect(() => { count++; });

    // 立即執行一次
    expect(count).toBe(1);

    // 呼叫 dispose 不應丟錯
    expect(() => dispose()).not.toThrow();
  });
});

describe('EffectInstance: nested withObserver context interoperability', () => {
  it('works with withObserver nesting: inner effect tracking does not leak to outer', () => {
    const outer = new EffectInstance(() => {});
    const inner = new EffectInstance(() => {});
    const dep1 = makeNode('signal');
    const dep2 = makeNode('signal');

    // 手動使用 withObserver 來模擬 nested 執行狀態
    withObserver(outer.node, () => {
      track(dep1); // outer 觀察 dep1

      withObserver(inner.node, () => {
        track(dep2); // inner 觀察 dep2
      });

      // 回到 outer 後再一次對 dep1 追蹤（不會重複建立）
      track(dep1);
    });

    expect(outer.node.deps.has(dep1)).toBe(true);
    expect(outer.node.deps.has(dep2)).toBe(false);
    expect(dep1.subs.has(outer.node)).toBe(true);

    expect(inner.node.deps.has(dep2)).toBe(true);
    expect(inner.node.deps.has(dep1)).toBe(false);
    expect(dep2.subs.has(inner.node)).toBe(true);
  });
});

describe('EffectInstance: error handling in cleanups', () => {
  it('cleanup errors are caught and do not break subsequent cleanups', () => {
    const calls: string[] = [];
    const ef = new EffectInstance(() => {
      onCleanup(() => calls.push('a'));
      onCleanup(() => { throw new Error('boom'); });
      onCleanup(() => calls.push('c'));
    });

    // 第一次 run 收集 cleanups
    ef.run();

    // 第二次 run 觸發前一次 cleanups（中間有 throw 但不應中斷後續）
    expect(() => ef.run()).not.toThrow();

    // LIFO 執行，且錯誤不阻斷：順序應為 c -> (boom) -> a
    // 只有 a, c 會被記錄；拋錯那個不會記錄
    expect(calls).toEqual(['c', 'a']);
  });
});
