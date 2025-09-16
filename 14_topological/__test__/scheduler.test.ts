import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 先把 markStale mock 掉（路徑依你的實際檔名調整）
vi.mock("../src/core/computed.js", () => ({
  markStale: vi.fn()
}));

// 型別在編譯期拿：type-only import
import type { Job as SchedulerJob } from "../src/core/scheduler.js";

// 動態載入，確保每個測試都拿到乾淨的 module 狀態
async function loadScheduler() {
  const mod = await import("../src/core/scheduler.js");
  const { markStale } = await import("../src/core/computed.js");
  return { ...mod, markStale };
}

// 支援自定義 run（並符合 exactOptionalPropertyTypes）
function makeJob(
  name: string,
  log: string[],
  opts: Partial<SchedulerJob> & { run?: () => void } = {}
): SchedulerJob {
  const j: SchedulerJob = {
    // 有給就用自訂 run，否則預設把名稱推進 log
    run: opts.run ?? (() => log.push(name)),
  };

  if (opts.kind !== undefined) j.kind = opts.kind;
  if (opts.priority !== undefined) j.priority = opts.priority;
  if (opts.dependsOn !== undefined) j.dependsOn = new Set(opts.dependsOn);
  if (opts.disposed !== undefined) j.disposed = opts.disposed;

  return j;
}

// 幫忙建一個假 Node（signal），讓 rollback 時測 markStale 被叫到
function makeSignalNode<T>(initial: T) {
  return {
    kind: "signal" as const,
    deps: new Set(),
    subs: new Set<any>(),
    value: initial
  };
}

describe("scheduler (topological + priority)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("同 phase/priority 以 enqueue 先後（FIFO）執行", async () => {
    const { scheduleJob, flushSync } = await loadScheduler();
    const runlog: string[] = [];

    const a = makeJob("A", runlog, { kind: "effect" }); // 預設 priority 0
    const b = makeJob("B", runlog, { kind: "effect" });

    scheduleJob(a);
    scheduleJob(b);
    flushSync();

    expect(runlog).toEqual(["A", "B"]);
  });

  it("computed 先於 effect（phase 權重）", async () => {
    const { scheduleJob, flushSync } = await loadScheduler();
    const runlog: string[] = [];

    const e = makeJob("E", runlog, { kind: "effect" });
    const c = makeJob("C", runlog, { kind: "computed" });

    scheduleJob(e);
    scheduleJob(c);
    flushSync();

    expect(runlog).toEqual(["C", "E"]);
  });

  it("priority：數字越小越優先（同 phase 比 priority）", async () => {
    const { scheduleJob, flushSync } = await loadScheduler();
    const runlog: string[] = [];

    const p1 = makeJob("P1", runlog, { kind: "effect", priority: 1 });
    const p0 = makeJob("P0", runlog, { kind: "effect", priority: 0 });
    const pn1 = makeJob("PN1", runlog, { kind: "effect", priority: -1 });

    scheduleJob(p1);
    scheduleJob(p0);
    scheduleJob(pn1);
    flushSync();

    expect(runlog).toEqual(["PN1", "P0", "P1"]);
  });

  it("拓樸排序：has dependsOn 必須在上游之後執行", async () => {
    const { scheduleJob, setJobDeps, flushSync } = await loadScheduler();
    const runlog: string[] = [];

    const up = makeJob("UP", runlog, { kind: "computed" });
    const down = makeJob("DOWN", runlog, { kind: "effect" });

    // 先 enqueue，再補依賴
    scheduleJob(down);
    scheduleJob(up);
    setJobDeps(down, [up]);

    flushSync();
    expect(runlog).toEqual(["UP", "DOWN"]);
  });

  it("混合：A(computed)->B(computed)->E(effect) 應為 A,B,E", async () => {
    const { scheduleJob, setJobDeps, flushSync } = await loadScheduler();
    const runlog: string[] = [];

    const A = makeJob("A", runlog, { kind: "computed" });
    const B = makeJob("B", runlog, { kind: "computed" });
    const E = makeJob("E", runlog, { kind: "effect" });

    setJobDeps(B, [A]);
    setJobDeps(E, [B]);

    // 故意先 enqueue E，再 A，再 B
    scheduleJob(E);
    scheduleJob(A);
    scheduleJob(B);

    flushSync();
    expect(runlog).toEqual(["A", "B", "E"]);
  });

  it("batch：同一輪合併，出 batch 才 flush；同一 job 不會重複執行", async () => {
    const { batch, scheduleJob, flushSync } = await loadScheduler();
    const runlog: string[] = [];

    const J = makeJob("J", runlog, { kind: "effect" });

    batch(() => {
      scheduleJob(J);
      scheduleJob(J); // Set 去重
      // 這裡不會自動 flush
      expect(runlog).toEqual([]);
    });

    // 出 batch 才會 flush
    expect(runlog).toEqual(["J"]);

    // 再 flushSync 沒有新 job 不會多跑
    flushSync();
    expect(runlog).toEqual(["J"]);
  });

  it("執行中 enqueue 新 job：下一輪才會被跑", async () => {
    const { scheduleJob, flushSync } = await loadScheduler();
    const runlog: string[] = [];

    let scheduledSecond = false;
    const first = makeJob("FIRST", runlog, {
      run: () => {
        runlog.push("FIRST");
        scheduleJob(second);
      }
    });

    const second = makeJob("SECOND", runlog, {});

    scheduleJob(first);
    flushSync(); // 只會跑 FIRST，SECOND 進下一輪
    expect(runlog).toEqual(["FIRST"]);

    flushSync(); // 下一輪把 SECOND 跑掉
    expect(runlog).toEqual(["FIRST", "SECOND"]);
  });

  it("flushSync：可強制同步 flush 目前已排程的 job", async () => {
    const { scheduleJob, flushSync } = await loadScheduler();
    const runlog: string[] = [];

    scheduleJob(makeJob("X", runlog, {}));
    flushSync();
    expect(runlog).toEqual(["X"]);
  });
});

describe("atomic / transaction", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("atomic commit：值保留新值，job 正常執行，inAtomic 在區塊內為 true", async () => {
    const {
      atomic,
      inAtomic,
      recordAtomicWrite,
      scheduleJob,
      flushSync
    } = await loadScheduler();

    const runlog: string[] = [];
    const node = makeSignalNode<number>(1);
    const job = makeJob("E", runlog, { kind: "effect" });

    const result = atomic(() => {
      expect(inAtomic()).toBe(true);
      // 紀錄舊值
      recordAtomicWrite(node as any, node.value);
      // 改值（成功 commit 應保留）
      node.value = 2;
      scheduleJob(job);
      return 42;
    });

    expect(result).toBe(42);
    flushSync();
    expect(runlog).toEqual(["E"]);
    expect(node.value).toBe(2); // commit 後維持新值
  });

  it("atomic rollback（同步 throw）：回寫舊值且標髒下游 computed、靜音期間不進隊列", async () => {
    const {
      atomic,
      recordAtomicWrite,
      scheduleJob,
      flushSync,
      inAtomic,
      markStale
    } = await loadScheduler();

    const runlog: string[] = [];
    const node = makeSignalNode<number>(10);

    // 假裝有一個 computed 訂閱這個 signal
    const computedNode = { kind: "computed" as const };
    node.subs.add(computedNode);

    const willNotRun = makeJob("WONT", runlog, { kind: "effect" });

    expect(() =>
      atomic(() => {
        expect(inAtomic()).toBe(true);
        recordAtomicWrite(node as any, node.value);
        node.value = 999; // 會被回滾
        // 即使嘗試排程，也會因 muted 而被忽略
        scheduleJob(willNotRun);
        throw new Error("fail");
      })
    ).toThrowError("fail");

    // rollback 已經把值回寫
    expect(node.value).toBe(10);

    // 在 rollback 中，對下游 computed 呼叫 markStale
    expect(markStale).toHaveBeenCalledTimes(1);
    expect(markStale).toHaveBeenCalledWith(computedNode);

    // 被排進去的 job 不會執行（清空 + 靜音）
    flushSync();
    expect(runlog).toEqual([]);
  });

  it("transaction (async) resolve：成功 commit", async () => {
    const {
      transaction,
      inAtomic,
      recordAtomicWrite,
      scheduleJob,
      flushSync
    } = await loadScheduler();

    const runlog: string[] = [];
    const node = makeSignalNode<string>("a");
    const job = makeJob("DONE", runlog, {});

    const out = await transaction(async () => {
      expect(inAtomic()).toBe(true);
      recordAtomicWrite(node as any, node.value);
      node.value = "b";
      scheduleJob(job);
      await Promise.resolve(); // 任意 async 邏輯
      return "ok";
    });

    expect(out).toBe("ok");
    flushSync();
    expect(runlog).toEqual(["DONE"]);
    expect(node.value).toBe("b");
  });

  it("transaction (async) reject：rollback 生效", async () => {
    const { transaction, recordAtomicWrite } = await loadScheduler();

    const node = makeSignalNode<number>(7);

    await expect(
      transaction(async () => {
        recordAtomicWrite(node as any, node.value);
        node.value = 123;
        await Promise.resolve();
        throw new Error("nope");
      })
    ).rejects.toThrowError("nope");

    expect(node.value).toBe(7); // 回滾成功
  });
});
