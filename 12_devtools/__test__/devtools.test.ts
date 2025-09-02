import { describe, it, expect, vi, beforeEach } from "vitest";

// 建一個最小的 Node 工具
type K = "signal" | "computed" | "effect";
type TestNode = { kind: K; deps: Set<TestNode>; subs: Set<TestNode> };
const makeNode = (kind: K): TestNode => ({ kind, deps: new Set(), subs: new Set() });
const link = (upstream: TestNode, downstream: TestNode) => {
  downstream.deps.add(upstream);
  upstream.subs.add(downstream);
};

// 每次用目前模組（不強求 seq=1），斷言都以「實際取到的 id」為準
async function loadMod() {
  const mod = await import("../src/core/devtools/inspect.js");
  return mod as unknown as {
    inspect: (n: TestNode) => {
      id: string;
      kind: K;
      inDegree: number;
      outDegree: number;
      deps: { id: string; kind: K }[];
      subs: { id: string; kind: K }[];
    };
    logInspect: (n: TestNode) => void;
    inspectRecursive: (
      n: TestNode,
      depth?: number
    ) => {
      center: string;
      nodes: { id: string; kind: K }[];
      edges: { from: string; to: string; dir: "deps" | "subs" }[];
    };
    toMermaid: (n: TestNode, depth?: number) => string;
  };
}

describe("inspect utilities", () => {
  beforeEach(() => {
    vi.restoreAllMocks(); // 不重置模組，避免破壞其他套件狀態；改用動態 id 斷言
  });

  it("inspect(): 基本快照（度數/ids）", async () => {
    const { inspect } = await loadMod();
    // a -> b -> c
    const a = makeNode("signal");
    const b = makeNode("computed");
    const c = makeNode("effect");
    link(a, b);
    link(b, c);

    const snapB = inspect(b);
    const snapA = inspect(a); // 取出實際 id
    const snapC = inspect(c);

    expect(snapB.kind).toBe("computed");
    expect(snapB.inDegree).toBe(1);
    expect(snapB.outDegree).toBe(1);

    // 用 inspect 的 id 來對比，不假設序號
    expect(snapB.deps).toEqual([{ id: snapA.id, kind: "signal" }]);
    expect(snapB.subs).toEqual([{ id: snapC.id, kind: "effect" }]);

    // 格式大致正確
    expect(snapB.id).toMatch(/^computed#\d+$/);
    expect(snapA.id).toMatch(/^signal#\d+$/);
    expect(snapC.id).toMatch(/^effect#\d+$/);
  });

  it("logInspect(): 有/無 deps/subs 的輸出", async () => {
    const { logInspect, inspect } = await loadMod();

    const a = makeNode("signal");
    const b = makeNode("computed");
    const c = makeNode("effect");
    link(a, b);
    link(b, c);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const tableSpy = vi
      .spyOn(console, "table")
      .mockImplementation(() => {});

    logInspect(b);

    // 先抓一次預期 id
    const idB = inspect(b).id; // computed#1（理論上）
    const idA = inspect(a).id; // signal#2
    const idC = inspect(c).id; // effect#3

    // 概要行
    expect(logSpy).toHaveBeenCalledWith(
      `[inspect] ${idB} (computed)  in=1  out=1`
    );

    // 有 deps -> 印 "deps ↑" + table
    expect(logSpy).toHaveBeenCalledWith("  deps ↑");
    expect(tableSpy).toHaveBeenCalledWith([{ id: idA, kind: "signal" }]);

    // 有 subs -> 印 "subs ↓" + table
    expect(logSpy).toHaveBeenCalledWith("  subs ↓");
    expect(tableSpy).toHaveBeenCalledWith([{ id: idC, kind: "effect" }]);

    // 測另一個無 deps/subs 的節點
    const solo = makeNode("signal");
    logSpy.mockClear();
    tableSpy.mockClear();

    logInspect(solo);
    const idSolo = inspect(solo).id;
    expect(logSpy).toHaveBeenCalledWith(
      `[inspect] ${idSolo} (signal)  in=0  out=0`
    );
    expect(logSpy).toHaveBeenCalledWith("  deps ↑ (none)");
    expect(logSpy).toHaveBeenCalledWith("  subs ↓ (none)");
    expect(tableSpy).not.toHaveBeenCalled();
  });

   it("inspectRecursive(): 控制向上/向下深度並避免循環", async () => {
    const { inspect, inspectRecursive } = await loadMod();

    // a -> b -> c 並讓 c -> a 形成圈
    const a = makeNode("signal");
    const b = makeNode("computed");
    const c = makeNode("effect");
    link(a, b);
    link(b, c);
    link(c, a);

    const idA = inspect(a).id;
    const idB = inspect(b).id;
    const idC = inspect(c).id;

    const g = inspectRecursive(b, 1);

    expect(g.center).toBe(idB);
    const nodeIds = new Set(g.nodes.map(n => n.id));
    expect(nodeIds.has(idA)).toBe(true);
    expect(nodeIds.has(idB)).toBe(true);
    expect(nodeIds.has(idC)).toBe(true);

    // depth=1 僅直接關係：deps(a->b) 與 subs(b->c)
    expect(g.edges).toEqual([
      { from: idA, to: idB, dir: "deps" },
      { from: idB, to: idC, dir: "subs" },
    ]);
    expect(g.edges).toHaveLength(2); // 不會展開 c->a 再往上
  });

  it("toMermaid(): 以實際 id 檢查節點與邊（含 sanitize）", async () => {
    const { inspect, toMermaid } = await loadMod();

    const a = makeNode("signal");
    const b = makeNode("computed");
    link(a, b);

    const idA = inspect(a).id;
    const idB = inspect(b).id;

    const out = toMermaid(b, 1);

    // 有標頭
    expect(out).toContain("graph TD");

    // 節點方塊（帶 id）
    expect(out).toContain(`${idB}["${idB}"]`);
    expect(out).toContain(`${idA}["${idA}"]`);

    // 邊（a -> b）
    expect(out).toContain(`${idA} --> ${idB}`);
  });
});
