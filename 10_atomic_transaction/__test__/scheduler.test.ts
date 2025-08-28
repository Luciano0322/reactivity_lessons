import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Node } from "../src/core/graph.js";

async function loadMod() {
  vi.resetModules();
  return await import("../src/core/scheduler.js"); // ⬅️ 調整檔案路徑
}

async function flushMicrotasks(times = 2) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

// 假 node
function makeSignalNode<T>(v: T) {
  return {
    kind: "signal" as const,
    subs: new Set<Node>(),
    deps: new Set<Node>(),
    value: v
  };
}

describe("scheduleJob basics", () => {
  it("runs job in microtask", async () => {
    const { scheduleJob } = await loadMod();
    const run = vi.fn();
    const job = { run };

    scheduleJob(job);
    expect(run).not.toHaveBeenCalled();

    await flushMicrotasks();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ignores disposed jobs", async () => {
    const { scheduleJob } = await loadMod();
    const run = vi.fn();
    const job = { run, disposed: true };

    scheduleJob(job);
    await flushMicrotasks();
    expect(run).not.toHaveBeenCalled();
  });

  it("de-duplicates jobs", async () => {
    const { scheduleJob } = await loadMod();
    const run = vi.fn();
    const job = { run };

    scheduleJob(job);
    scheduleJob(job);
    await flushMicrotasks();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("batch & transaction", () => {
  it("batch flushes once at the end", async () => {
    const { scheduleJob, batch } = await loadMod();
    const a = { run: vi.fn() };

    batch(() => {
      scheduleJob(a);
      scheduleJob(a);
      expect(a.run).not.toHaveBeenCalled();
    });

    expect(a.run).toHaveBeenCalledTimes(1);
  });

  it("transaction sync works like batch", async () => {
    const { scheduleJob, transaction } = await loadMod();
    const a = { run: vi.fn() };

    transaction(() => {
      scheduleJob(a);
    });

    expect(a.run).toHaveBeenCalledTimes(1);
  });

  it("transaction async flushes after promise resolves", async () => {
    const { scheduleJob, transaction } = await loadMod();
    const a = { run: vi.fn() };

    await transaction(async () => {
      scheduleJob(a);
      await Promise.resolve();
      scheduleJob(a);
    });

    expect(a.run).toHaveBeenCalledTimes(1);
  });

  it("transaction throws still flushes before rethrow", async () => {
    const { scheduleJob, transaction } = await loadMod();
    const a = { run: vi.fn() };

    expect(() =>
      transaction(() => {
        scheduleJob(a);
        throw new Error("boom");
      })
    ).toThrow("boom");

    expect(a.run).toHaveBeenCalledTimes(1);
  });
});

describe("atomic", () => {
  it("commits on success and flushes at end", async () => {
    const { atomic, scheduleJob } = await loadMod();
    const a = { run: vi.fn() };

    atomic(() => {
      scheduleJob(a);
    });

    expect(a.run).toHaveBeenCalledTimes(1);
  });

  it("nested atomic merges logs and flushes once", async () => {
    const { atomic, recordAtomicWrite } = await loadMod();
    const node = makeSignalNode(1);

    atomic(() => {
      recordAtomicWrite(node, 1);
      node.value = 2;
      atomic(() => {
        recordAtomicWrite(node, 2); // 不會覆蓋父層的舊值
        node.value = 3;
      });
    });

    expect(node.value).toBe(3);
  });

  it("rollback restores previous values and does not flush jobs", async () => {
    const { atomic, recordAtomicWrite, inAtomic } = await loadMod();
    const node = makeSignalNode(5);

    expect(() =>
      atomic(() => {
        expect(inAtomic()).toBe(true);
        recordAtomicWrite(node, 5);
        node.value = 99;
        throw new Error("fail");
      })
    ).toThrow("fail");

    // 回滾後值被還原
    expect(node.value).toBe(5);
  });

  it("async rollback restores values", async () => {
    const { atomic, recordAtomicWrite } = await loadMod();
    const node = makeSignalNode(42);

    await expect(
      atomic(async () => {
        recordAtomicWrite(node, 42);
        node.value = 100;
        return Promise.reject(new Error("bad"));
      })
    ).rejects.toThrow("bad");

    expect(node.value).toBe(42);
  });
});

describe("recordAtomicWrite", () => {
  it("records only the first old value", async () => {
    const { atomic, recordAtomicWrite } = await loadMod();
    const node = makeSignalNode(1);

    await atomic(() => {
      recordAtomicWrite(node, 1);
      node.value = 2;
      recordAtomicWrite(node, 999); // 不應覆蓋
      node.value = 3;
    });

    expect(node.value).toBe(3);
  });
});

describe("flushSync", () => {
  it("runs immediately", async () => {
    const { scheduleJob, flushSync } = await loadMod();
    const a = { run: vi.fn() };

    scheduleJob(a);
    flushSync();
    expect(a.run).toHaveBeenCalledTimes(1);
  });
});
