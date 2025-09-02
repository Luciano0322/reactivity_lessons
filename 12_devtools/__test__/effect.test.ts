import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// 頂層 mock（副檔名要和原始碼一致 .js）
vi.mock("../src/core/devtools/hotspot.js", () => {
  return {
    registerNode: vi.fn(),
    unregisterNode: vi.fn(),
    // 要把包住的函式真的執行，避免影響行為
    withTiming: vi.fn((node: any, fn: () => unknown) => fn()),
  };
});

describe("effect() with hotspot integration", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("建立時會註冊節點（registerNode 只呼叫一次，且節點為 effect）", async () => {
    const hotspot = await import("../src/core/devtools/hotspot.js");
    const { createEffect } = await import("../src/core/effect.js");

    const disposer = createEffect(() => { /* no-op */ });
    expect(hotspot.registerNode).toHaveBeenCalledTimes(1);

    const nodeArg = (hotspot.registerNode as any).mock.calls[0][0];
    // 基本狀態檢查
    expect(nodeArg && typeof nodeArg).toBe("object");
    expect(nodeArg.kind).toBe("effect");
    expect(nodeArg.deps instanceof Set).toBe(true);
    expect(nodeArg.subs instanceof Set).toBe(true);

    disposer(); // 清掉
  });

  it("run() 時以 withTiming 包住執行；重複 run() 會再次呼叫 withTiming", async () => {
    const hotspot = await import("../src/core/devtools/hotspot.js");
    const { EffectInstance } = await import("../src/core/effect.js");

    const spy = vi.fn();
    const inst = new EffectInstance(spy);

    // 第一次 run：建構後不會自動跑，要手動 run()
    inst.run();
    expect(hotspot.withTiming).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);

    // 再 run 一次：withTiming & 本體函式再次被呼叫
    inst.run();
    expect(hotspot.withTiming).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("withTiming 的 node 參數就是註冊到的同一個 effect 節點", async () => {
    const hotspot = await import("../src/core/devtools/hotspot.js");
    const { EffectInstance } = await import("../src/core/effect.js");

    const inst = new EffectInstance(() => {});
    inst.run();

    // 取出第一次 registerNode 與 withTiming 的 node
    const regNode = (hotspot.registerNode as any).mock.calls[0][0];
    const withTimingNode = (hotspot.withTiming as any).mock.calls[0][0];

    expect(regNode).toBe(withTimingNode);
    expect(withTimingNode.kind).toBe("effect");
  });

  it("dispose() 會呼叫 unregisterNode；之後再 run() 不會再觸發 withTiming", async () => {
    const hotspot = await import("../src/core/devtools/hotspot.js");
    const { EffectInstance } = await import("../src/core/effect.js");

    const inst = new EffectInstance(() => {});
    inst.run();
    const before = (hotspot.withTiming as any).mock.calls.length;

    inst.dispose();
    expect(hotspot.unregisterNode).toHaveBeenCalledTimes(1);
    const unregNode = (hotspot.unregisterNode as any).mock.calls[0][0];
    expect(unregNode.kind).toBe("effect");

    // disposed 後再呼叫 run()，不應再進 withTiming
    inst.run();
    expect((hotspot.withTiming as any).mock.calls.length).toBe(before);
  });

  it("createEffect() 會立即執行一次（withTiming 也會被呼叫）", async () => {
    const hotspot = await import("../src/core/devtools/hotspot.js");
    const { createEffect } = await import("../src/core/effect.js");

    const fn = vi.fn();
    const dispose = createEffect(fn);

    expect(hotspot.withTiming).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);

    dispose();
  });
});
