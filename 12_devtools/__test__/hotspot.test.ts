import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// 路徑依你的專案調整
const loadMod = async () =>
  (await import("../src/core/devtools/hotspot.js")) as unknown as {
    registerNode: (n: TestNode) => void;
    unregisterNode: (n: TestNode) => void;
    recordUpdate: (n: TestNode) => void;
    withTiming: <T>(n: TestNode, fn: () => T) => T;
    allNodes: () => Iterable<TestNode>;
    topHotspots: (
      n?: number,
      by?: "freq" | "updates" | "avgTime",
      nodes?: Iterable<TestNode>
    ) => Array<{
      kind: K;
      updates: number;
      freqPerMin: number;
      avgMs: number;
      inDegree: number;
      outDegree: number;
    }>;
    logTopHotspots: (
      n?: number,
      by?: "freq" | "updates" | "avgTime",
      nodes?: Iterable<TestNode>
    ) => void;
    resetHotspots: () => void;
  };

// ---- 測試用最小 Node 型別 ----
type K = "signal" | "computed" | "effect";
type TestNode = {
  kind: K;
  deps: Set<TestNode>;
  subs: Set<TestNode>;
};
const makeNode = (k: K): TestNode => ({ kind: k, deps: new Set(), subs: new Set() });

// ---- 可控的 performance.now() ----
let fakeNow = 0;
const advance = (ms: number) => {
  fakeNow += ms;
};

beforeEach(() => {
  // 控制 performance.now，使時間推進可預期
  fakeNow = 0;
  vi.spyOn(performance, "now").mockImplementation(() => fakeNow);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hotspots module", () => {
  beforeEach(async () => {
    // 每個測試初始化內部 WeakMap/Set
    const m = await loadMod();
    m.resetHotspots();
  });

  it("register/unregister + allNodes()：可列出/移除活躍節點", async () => {
    const m = await loadMod();
    const a = makeNode("signal");
    const b = makeNode("computed");

    m.registerNode(a);
    m.registerNode(b);

    const listed1 = Array.from(m.allNodes());
    expect(new Set(listed1)).toEqual(new Set([a, b]));

    m.unregisterNode(a);
    const listed2 = Array.from(m.allNodes());
    expect(listed2).toEqual([b]);
  });

  it("recordUpdate()：更新次數 + EMA（注意第一次會衝到 12000，第二次才往 60 收斂為 9612）", async () => {
    const m = await loadMod();
    const n = makeNode("signal");
    m.registerNode(n);

    // 第一次：dt=1 → inst=60000 → EMA=12000
    m.recordUpdate(n);

    // 間隔 1000ms → 第二次：inst=60 → EMA=0.2*60 + 0.8*12000 = 9612
    advance(1000);
    m.recordUpdate(n);

    const row = m.topHotspots(5, "freq").find(r => r.kind === "signal")!;
    expect(row.updates).toBe(2);
    // topHotspots 四捨五入兩位，這裡會變成 9612.00 → Number(…) = 9612
    expect(row.freqPerMin).toBeCloseTo(9612, 0);
  });

  it("withTiming()：包裹函式並統計平均執行時間", async () => {
    const m = await loadMod();
    const n = makeNode("computed");
    m.registerNode(n);

    const out = m.withTiming(n, () => {
      advance(5); // 模擬工作 5ms
      return 42;
    });
    expect(out).toBe(42);

    const [row] = m.topHotspots(1, "avgTime");
    expect(row?.kind).toBe("computed");
    expect(row?.avgMs).toBeCloseTo(5, 2);
    expect(row?.updates).toBe(1); // withTiming 內會先做一次 recordUpdate
  });

  it("topHotspots()：依 freq / updates / avgTime 正確排序", async () => {
    const m = await loadMod();
    const a = makeNode("signal");
    const b = makeNode("computed");
    const c = makeNode("effect");
    m.registerNode(a);
    m.registerNode(b);
    m.registerNode(c);

    // a：兩次更新，間隔 1000ms → 低頻
    m.recordUpdate(a);
    advance(1000);
    m.recordUpdate(a);

    // b：多次快速更新（間隔 1ms）→ 高頻 + 更新數量多
    m.recordUpdate(b);
    for (let i = 0; i < 5; i++) {
      advance(1);
      m.recordUpdate(b);
    }

    // c：以 withTiming 模擬較高平均耗時
    m.withTiming(c, () => {
      advance(30);
    });
    m.withTiming(c, () => {
      advance(50);
    }); // 平均 ~40ms

    // 預設 freq：b 應在最前
    const byFreq = m.topHotspots(3, "freq");
    expect(byFreq[0]?.kind).toBe("computed");

    // 依 updates：b 更新最多（6 次），其次 a/c（各 2 次）
    const byUpdates = m.topHotspots(3, "updates");
    expect(byUpdates.map(r => r.updates)).toEqual([6, 2, 2]);

    // 依 avgTime：c 的 avgMs 最大
    const byAvg = m.topHotspots(3, "avgTime");
    expect(byAvg[0]?.kind).toBe("effect");
    expect(byAvg[0]?.avgMs).toBeGreaterThan(byAvg[1]?.avgMs ?? 0);
  });

  it("topHotspots()：rows 含 in/out-degree 與數值欄位（不假設一定是小數）", async () => {
    const m = await loadMod();
    const up = makeNode("signal");
    const center = makeNode("computed");
    const down = makeNode("effect");
    // 連線：up -> center -> down
    center.deps.add(up);
    up.subs.add(center);
    center.subs.add(down);
    down.deps.add(center);

    m.registerNode(up);
    m.registerNode(center);
    m.registerNode(down);

    advance(100);
    m.recordUpdate(center);

    const rows = m.topHotspots(10, "updates");
    const cRow = rows.find(r => r.kind === "computed")!;
    expect(cRow.inDegree).toBe(1);
    expect(cRow.outDegree).toBe(1);
    // 只檢查型別與非負，不硬性要求小數（第一次會是 12000 整數）
    expect(typeof cRow.freqPerMin).toBe("number");
    expect(cRow.freqPerMin).toBeGreaterThanOrEqual(0);
    expect(typeof cRow.avgMs).toBe("number");
  });

  it("logTopHotspots()：輸出欄位格式正確", async () => {
    const m = await loadMod();
    const n = makeNode("signal");
    m.registerNode(n);
    m.recordUpdate(n);

    const spy = vi.spyOn(console, "table").mockImplementation(() => {});
    m.logTopHotspots(5, "freq");
    expect(spy).toHaveBeenCalledTimes(1);

    const arg = spy.mock.calls[0]?.[0] as Array<Record<string, any>>;
    // 欄位名稱符合格式
    const keys = Object.keys(arg[0] || {});
    expect(keys).toEqual([
      "kind",
      "updates",
      "freq (/min)",
      "avg ms",
      "in-degree",
      "out-degree",
    ]);

    spy.mockRestore();
  });

  it("resetHotspots()：清空 WeakMap 與 liveNodes", async () => {
    const m = await loadMod();
    const n = makeNode("signal");
    m.registerNode(n);
    m.recordUpdate(n);

    expect(Array.from(m.allNodes()).length).toBe(1);
    expect(m.topHotspots(1).length).toBe(1);

    m.resetHotspots();

    expect(Array.from(m.allNodes()).length).toBe(0);
    expect(m.topHotspots(1).length).toBe(0);
  });
});
