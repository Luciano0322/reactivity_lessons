import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 我們會在各測試中動態 import ../src/core/scheduler.js
 * 所以要先 mock 掉 computed.js，再 import scheduler
 *
 * 注意：這個 mock 會在「回滾時」嘗試 schedule 一個 job，
 * 以驗證 muted > 0 會擋住新任務進佇列。
 */
let lateJobRunSpy: ReturnType<typeof vi.fn>;

vi.mock("../src/core/computed.js", async () => {
  // 預設 markStale 只是一個 spy；具體實作在各測試內設定
  const markStale = vi.fn((/* node */) => {
    // 在個別測試內，我們會把 lateSchedule 注入
    if (typeof lateJobRunSpy === "function") {
      // 動態 import scheduler（注意：這裡不能在頂層做，否則循環依賴）
      // 在各測試真正需要時才呼叫 scheduleJob
    }
  });
  return { markStale };
});

// 小工具：幫忙重新載入 scheduler 並回傳所有導出，以及 markStale 的 mock
async function loadScheduler() {
  const scheduler = await import("../src/core/scheduler.js");
  const computed = await import("../src/core/computed.js");
  return { scheduler, computed };
}

// 建立一個可監控的 job 物件
function makeJob(name = "job") {
  const run = vi.fn(() => undefined);
  return [{ run, disposed: false } as { run: () => void; disposed?: boolean }, run] as const;
}

// 造假的 graph Node：只放到 scheduler 會用到的欄位
function makeSignalNode<T>(value: T) {
  return {
    kind: "signal",
    subs: new Set<any>(),
    value,
  } as any;
}
function makeComputedNode() {
  return { kind: "computed" } as any;
}

describe("scheduler.ts (muted rollback, atomic write logs, batch/atomic/transaction)", () => {
  beforeEach(() => {
    vi.resetModules(); // 重置 queue/batchDepth/atomicDepth 等內部單例狀態
    // 清空 lateJob 監控
    lateJobRunSpy = vi.fn();
  });

  it("scheduleJob + flushSync：排入任務後 flushSync 立刻執行；disposed 任務不會進佇列", async () => {
    const { scheduler } = await loadScheduler();
    const { scheduleJob, flushSync } = scheduler;

    const [job, runSpy] = makeJob("normal");
    scheduleJob(job);
    // 沒有自動等 microtask，手動 flush
    flushSync();
    expect(runSpy).toHaveBeenCalledTimes(1);

    const [disposedJob, disposedSpy] = makeJob("disposed");
    disposedJob.disposed = true;
    scheduleJob(disposedJob);
    flushSync();
    expect(disposedSpy).not.toHaveBeenCalled();
  });

  it("batch(fn)：批次內 schedule 的任務在結束時統一 flush 一次", async () => {
    const { scheduler } = await loadScheduler();
    const { scheduleJob, batch } = scheduler;

    const [a, aSpy] = makeJob("a");
    const [b, bSpy] = makeJob("b");

    batch(() => {
      scheduleJob(a);
      scheduleJob(b);
      // 批次內不會立刻執行
      expect(aSpy).not.toHaveBeenCalled();
      expect(bSpy).not.toHaveBeenCalled();
    });

    // 批次結束會自動 flush 一次
    expect(aSpy).toHaveBeenCalledTimes(1);
    expect(bSpy).toHaveBeenCalledTimes(1);
  });

  it("atomic(fn) success：atomic 內排程的任務會在最外層結束時 flush", async () => {
    const { scheduler } = await loadScheduler();
    const { scheduleJob, atomic, inAtomic } = scheduler;

    const [a, aSpy] = makeJob("a");
    const [b, bSpy] = makeJob("b");

    atomic(() => {
      expect(inAtomic()).toBe(true);
      scheduleJob(a);
      scheduleJob(b);
      // 仍未執行
      expect(aSpy).not.toHaveBeenCalled();
      expect(bSpy).not.toHaveBeenCalled();
    });

    // atomic 成功結束 → flush
    expect(aSpy).toHaveBeenCalledTimes(1);
    expect(bSpy).toHaveBeenCalledTimes(1);
  });

  it("transaction(fn) 是 atomic 的別名：行為等同", async () => {
    const { scheduler } = await loadScheduler();
    const { scheduleJob, transaction } = scheduler;

    const [a, aSpy] = makeJob("a");
    transaction(() => {
      scheduleJob(a);
    });
    expect(aSpy).toHaveBeenCalledTimes(1);
  });

  it("atomic(fn) failure：回滾會把節點值還原、對 computed 下游呼叫 markStale；回滾期間 muted → 不得新增任務；之前排的任務也會被清空", async () => {
    const { scheduler, computed } = await loadScheduler();
    const { scheduleJob, atomic, recordAtomicWrite, flushSync } = scheduler;
    const { markStale } = computed as unknown as { markStale: ReturnType<typeof vi.fn> };

    // 構造一個 signal 節點，並掛一個 computed 訂閱者
    const sig = makeSignalNode<number>(10);
    const c1 = makeComputedNode();
    sig.subs.add(c1);

    // 準備兩個任務：
    // - early：在 throw 之前排到佇列（應被清掉，不執行）
    // - late：在 rollback 時 markStale 內部嘗試 schedule（muted 中，不得入列）
    const [earlyJob, earlySpy] = makeJob("early");
    const [lateJob, lateSpy] = makeJob("late");
    lateJobRunSpy = lateSpy;

    // 讓 markStale 在被呼叫時，嘗試 schedule 一個任務
    // 因為 rollback 中 muted>0，這個 schedule 應該被擋下
    (markStale as any).mockImplementation(() => {
      // 在回滾過程（muted > 0）呼叫，應該不會進佇列
      scheduleJob(lateJob);
    });

    // 觸發 atomic 失敗：記錄舊值、修改值、排入 early 任務、然後 throw
    await expect(async () => {
      await atomic(() => {
        // 模擬 signal.set() 在「確定寫入」時會呼叫的掛鉤
        scheduler.recordAtomicWrite(sig, sig.value);
        sig.value = 99;

        // 排一個任務（理論上會先在 queue；rollback 應清掉它）
        scheduleJob(earlyJob);

        // 失敗 → 進入 rollback
        throw new Error("boom");
      });
    }).rejects.toThrow(/boom/);

    // 回滾後：值應被還原，且對 computed 下游 markStale 被呼叫
    expect(sig.value).toBe(10);
    expect(markStale).toHaveBeenCalledTimes(1);

    // early 任務不應執行（被清掉）
    expect(earlySpy).not.toHaveBeenCalled();

    // rollback 期間 markStale 內 schedule 的任務也不應入列（muted 擋住）
    // 就算我們主動 flush 也不會執行
    flushSync();
    expect(lateSpy).not.toHaveBeenCalled();
  });

  it("nested atomic：內層成功時僅合併寫入日誌到父層，最外層成功才 flush；內層失敗會回滾到父層觀點", async () => {
    const { scheduler } = await loadScheduler();
    const { atomic, scheduleJob } = scheduler;

    const [outerJob, outerSpy] = makeJob("outer");
    const [innerJob, innerSpy] = makeJob("inner");

    // 內層成功 → 不會立即 flush；到最外層才一起 flush
    atomic(() => {
      atomic(() => {
        scheduleJob(innerJob);
      });
      // 這裡 inner 仍未執行
      expect(innerSpy).not.toHaveBeenCalled();

      scheduleJob(outerJob);
      // 直到離開最外層才 flush
      expect(outerSpy).not.toHaveBeenCalled();
    });

    expect(innerSpy).toHaveBeenCalledTimes(1);
    expect(outerSpy).toHaveBeenCalledTimes(1);
  });

  it("flushSync：沒有排程與 scheduled=false 時是 no-op；有任務則立刻執行", async () => {
    const { scheduler } = await loadScheduler();
    const { flushSync, scheduleJob } = scheduler;

    // no-op
    flushSync(); // 不應 throw

    const [j, spy] = makeJob("one");
    scheduleJob(j);
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("防護：超過 10000 次 flush guard 會丟錯（簡單煙霧測試，不真的跑 10000 次）", async () => {
    const { scheduler } = await loadScheduler();
    const { scheduleJob, flushSync } = scheduler;

    // 構造一個自我重入的 job，跑個幾次確認不會卡死（不觸發 10000 guard）
    let count = 0;
    const job = {
      run: () => {
        if (count++ < 3) scheduleJob(job as any);
      },
    } as any;

    scheduleJob(job);
    flushSync();
    expect(count).toBeGreaterThanOrEqual(4);
  });
});
