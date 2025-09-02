// 12_devtools/__test__/computed.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../src/core/devtools/hotspot.js", () => ({
  registerNode: vi.fn(),
  recordUpdate: vi.fn(),
  withTiming: vi.fn((_, fn) => fn()), // 要執行回呼，computed 才會真的重算
}));

// 幫手：每次都重新載入模組，確保吃到 mock 與乾淨狀態
async function loadAll() {
  const hotspot = await import("../src/core/devtools/hotspot.js");
  const { computed } = await import("../src/core/computed.js");
  const { signal } = await import("../src/core/signal.js");
  return { hotspot: hotspot as any, computed, signal };
}

describe("computed() with hotspot integration", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("在建立時會註冊節點（registerNode 只呼叫一次，且節點為 computed）", async () => {
    const { hotspot, computed } = await loadAll();
    const c = computed(() => 42);
    expect(hotspot.registerNode).toHaveBeenCalledTimes(1);
    const nodeArg = hotspot.registerNode.mock.calls[0][0];
    expect(nodeArg.kind).toBe("computed");

    c.get(); // 再 get() 不會再註冊
    expect(hotspot.registerNode).toHaveBeenCalledTimes(1);
  });

  it("第一次 get() 會以 withTiming 包住重算；非 stale 的重複 get() 不會再呼叫 withTiming", async () => {
    const { hotspot, computed } = await loadAll();
    const c = computed(() => 7 * 6);

    expect(hotspot.withTiming).not.toHaveBeenCalled();
    expect(c.get()).toBe(42);
    expect(hotspot.withTiming).toHaveBeenCalledTimes(1);

    // 非 stale 再 get 不應重算
    expect(c.get()).toBe(42);
    expect(hotspot.withTiming).toHaveBeenCalledTimes(1);
  });

  it("withTiming 的 node 參數就是註冊到的同一個 computed 節點", async () => {
    const { hotspot, computed } = await loadAll();
    const c = computed(() => 1);
    c.get();

    const registered = hotspot.registerNode.mock.calls[0][0];
    const timedNode = hotspot.withTiming.mock.calls[0][0];
    expect(timedNode).toBe(registered);
    expect(timedNode.kind).toBe("computed");
  });

  it("來源改變 → 標記 stale（由 computed 內部流程負責）→ 下一次 get() 會重算（withTiming 再次被呼叫），且值更新", async () => {
    const { hotspot, computed, signal } = await loadAll();
    const s = signal(1);
    const c = computed(() => s.get() * 10);

    expect(c.get()).toBe(10);
    expect(hotspot.withTiming).toHaveBeenCalledTimes(1);

    s.set(2); // 讓下游 computed 變 stale
    expect(c.get()).toBe(20);
    expect(hotspot.withTiming).toHaveBeenCalledTimes(2);
  });

  it("dispose() 會斷開依賴與訂閱；hotspot 不受影響，但不再保留圖上的連結", async () => {
    const { hotspot, computed, signal } = await loadAll();
    const src = signal(3);
    const c = computed(() => src.get() + 1);

    c.get();
    expect(hotspot.withTiming).toHaveBeenCalledTimes(1);

    c.dispose();
    src.set(10); // 不應觸發舊連結

    // 再 get() 會重新建立依賴並重算一次
    expect(c.get()).toBe(11);
    expect(hotspot.withTiming).toHaveBeenCalledTimes(2);
  });
});
