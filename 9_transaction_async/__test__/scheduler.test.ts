import { describe, it, expect, vi, beforeEach } from 'vitest';

// 動態載入以重置模組內部狀態
async function loadScheduler() {
  vi.resetModules();
  // ⬇️ 依你的實際路徑調整
  return await import('../src/core/scheduler.js');
}

// 小工具：flush microtasks
async function flushMicrotasks(times = 2) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('scheduler basics', () => {
  it('scheduleJob: runs in next microtask & de-duplicates per flush', async () => {
    const { scheduleJob } = await loadScheduler();

    const run = vi.fn();
    const job = { run };

    scheduleJob(job);
    // 尚未執行
    expect(run).not.toHaveBeenCalled();

    await flushMicrotasks();
    expect(run).toHaveBeenCalledTimes(1);

    // 再次多次排同一個 job，下一輪只跑一次
    scheduleJob(job);
    scheduleJob(job);
    scheduleJob(job);
    await flushMicrotasks();
    expect(run).toHaveBeenCalledTimes(2); // +1
  });

  it('ignores disposed jobs', async () => {
    const { scheduleJob } = await loadScheduler();

    const run = vi.fn();
    const job = { run, disposed: true };

    scheduleJob(job);
    await flushMicrotasks();
    expect(run).not.toHaveBeenCalled();
  });
});

describe('batch()', () => {
  it('coalesces sync schedules and flushes once at the end (no microtask needed)', async () => {
    const mod = await loadScheduler();
    const { scheduleJob, batch } = mod;

    const qSpy = vi.spyOn(globalThis, 'queueMicrotask');

    const a = { run: vi.fn() };
    const b = { run: vi.fn() };

    batch(() => {
      scheduleJob(a);
      scheduleJob(a);
      scheduleJob(b);
      scheduleJob(b);
      // 批次內不應排 microtask
      expect(qSpy).not.toHaveBeenCalled();
      // 也尚未執行
      expect(a.run).not.toHaveBeenCalled();
      expect(b.run).not.toHaveBeenCalled();
    });

    // 批次結束應已同步 flush
    expect(a.run).toHaveBeenCalledTimes(1);
    expect(b.run).toHaveBeenCalledTimes(1);

    // 後續 microtask 不應再重跑
    await flushMicrotasks();
    expect(a.run).toHaveBeenCalledTimes(1);
    expect(b.run).toHaveBeenCalledTimes(1);

    qSpy.mockRestore();
  });

  it('nested batch only flushes at the outer-most end', async () => {
    const { scheduleJob, batch } = await loadScheduler();

    const a = { run: vi.fn() };

    batch(() => {
      batch(() => {
        scheduleJob(a);
      });
      // 內層結束時不 flush
      expect(a.run).not.toHaveBeenCalled();
    });

    // 外層結束才 flush
    expect(a.run).toHaveBeenCalledTimes(1);
  });
});

describe('transaction()', () => {
  it('sync transaction behaves like batch', async () => {
    const { scheduleJob, transaction } = await loadScheduler();

    const a = { run: vi.fn() };

    transaction(() => {
      scheduleJob(a);
    });

    expect(a.run).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
    expect(a.run).toHaveBeenCalledTimes(1);
  });

  it('async transaction coalesces across awaits and flushes once on resolve', async () => {
    const { scheduleJob, transaction } = await loadScheduler();

    const a = { run: vi.fn() };

    const p = transaction(async () => {
      scheduleJob(a);                 // 1
      await Promise.resolve();
      scheduleJob(a);                 // 2
      await Promise.resolve();
      scheduleJob(a);                 // 3
      // 在 transaction 尚未結束前都不應該執行
      expect(a.run).not.toHaveBeenCalled();
    });

    // 等 transaction 完成（finally 內會 flush 一次）
    await p;
    expect(a.run).toHaveBeenCalledTimes(1);

    // 後續 microtask 不會再跑
    await flushMicrotasks();
    expect(a.run).toHaveBeenCalledTimes(1);
  });

  it('transaction flushes even if the function throws (sync)', async () => {
    const { scheduleJob, transaction } = await loadScheduler();

    const a = { run: vi.fn() };

    await expect(async () => {
      transaction(() => {
        scheduleJob(a);
        throw new Error('boom');
      });
    }).rejects.toThrow(/boom/);

    // 仍應 flush
    expect(a.run).toHaveBeenCalledTimes(1);
  });

  it('transaction flushes even if the async function rejects', async () => {
    const { scheduleJob, transaction } = await loadScheduler();

    const a = { run: vi.fn() };

    await expect(
      transaction(async () => {
        scheduleJob(a);
        await Promise.resolve();
        throw new Error('bad');
      })
    ).rejects.toThrow(/bad/);

    expect(a.run).toHaveBeenCalledTimes(1);
  });
});

describe('flushSync()', () => {
  it('runs immediately without awaiting microtasks', async () => {
    const { scheduleJob, flushSync } = await loadScheduler();

    const a = { run: vi.fn() };

    scheduleJob(a);
    // 直接強制 flush
    flushSync();
    expect(a.run).toHaveBeenCalledTimes(1);

    // 後續 microtask 不會再跑
    await flushMicrotasks();
    expect(a.run).toHaveBeenCalledTimes(1);
  });
});

describe('queueMicrotask scheduling', () => {
  it('schedules at most one microtask per turn', async () => {
    const mod = await loadScheduler();
    const { scheduleJob } = mod;

    const qSpy = vi.spyOn(globalThis, 'queueMicrotask');

    const a = { run: vi.fn() };
    const b = { run: vi.fn() };

    scheduleJob(a);
    scheduleJob(b);
    scheduleJob(a);
    scheduleJob(b);

    // 這一輪只應該安排一次 microtask
    expect(qSpy).toHaveBeenCalledTimes(1);

    await flushMicrotasks();
    expect(a.run).toHaveBeenCalledTimes(1);
    expect(b.run).toHaveBeenCalledTimes(1);

    qSpy.mockRestore();
  });
});
