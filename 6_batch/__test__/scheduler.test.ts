import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  scheduleJob,
  batch,
  flushSync,
} from '../scheduler.js';

// 小工具：flush microtasks（queueMicrotask / Promise jobs）
async function flushMicrotasks(times = 2) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

const makeJob = () => {
  const run = vi.fn();
  return { run } as { run: () => void; disposed?: boolean };
};

beforeEach(() => {
  // 讓每個測試獨立：確保不受前一次微任務的影響
  vi.restoreAllMocks();
});

describe('scheduleJob + microtask flush', () => {
  it('schedules to next microtask and runs exactly once per tick (de-duplicated)', async () => {
    const job = makeJob();

    scheduleJob(job);
    scheduleJob(job); // 重複排程同一個 job 應該只跑一次

    expect(job.run).not.toHaveBeenCalled();

    await flushMicrotasks();

    expect(job.run).toHaveBeenCalledTimes(1);
  });

  it('ignores jobs marked as disposed', async () => {
    const job = makeJob();
    job.disposed = true;

    scheduleJob(job);
    await flushMicrotasks();

    expect(job.run).not.toHaveBeenCalled();
  });
});

describe('batch()', () => {
  it('defers flushing until batch exits (single run at the end)', async () => {
    const job = makeJob();

    batch(() => {
      scheduleJob(job);
      scheduleJob(job);
      // 在 batch 內不應立即執行
      expect(job.run).not.toHaveBeenCalled();
    });

    // 離開 batch 時會同步 flush，一次
    expect(job.run).toHaveBeenCalledTimes(1);

    // 等待 microtask 不應造成額外執行
    await flushMicrotasks();
    expect(job.run).toHaveBeenCalledTimes(1);
  });

  it('nested batches still flush once after outer batch exits', async () => {
    const job = makeJob();

    batch(() => {
      scheduleJob(job);
      batch(() => {
        scheduleJob(job);
      });
      scheduleJob(job);
      expect(job.run).not.toHaveBeenCalled();
    });

    expect(job.run).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
    expect(job.run).toHaveBeenCalledTimes(1);
  });
});

describe('flushSync()', () => {
  it('flushes immediately without waiting for microtasks', () => {
    const job = makeJob();

    scheduleJob(job);
    // 立刻清空
    flushSync();

    expect(job.run).toHaveBeenCalledTimes(1);
  });

  it('calling flushSync when nothing is scheduled is a no-op', () => {
    // 不應 throw 或有副作用
    expect(() => flushSync()).not.toThrow();
  });
});

describe('re-entrancy during flush (job scheduling another job)', () => {
  it('a job scheduled during a flush runs in the same overall flush cycle (next iteration)', async () => {
    const a = makeJob();
    const b = makeJob();

    // 當 A 執行時排程 B
    (a.run as any).mockImplementation(() => {
      scheduleJob(b);
    });

    scheduleJob(a);

    await flushMicrotasks();

    // A、B 都應執行一次；且 A 先於 B
    expect(a.run).toHaveBeenCalledTimes(1);
    expect(b.run).toHaveBeenCalledTimes(1);
    expect((a.run as any).mock.invocationCallOrder[0])
      .toBeLessThan((b.run as any).mock.invocationCallOrder[0]);
  });

  it('same job scheduled multiple times across ticks will run once per flush', async () => {
    const job = makeJob();

    // 第一次 tick
    scheduleJob(job);
    scheduleJob(job);
    await flushMicrotasks();
    expect(job.run).toHaveBeenCalledTimes(1);

    // 第二次 tick 再來一次
    scheduleJob(job);
    await flushMicrotasks();
    expect(job.run).toHaveBeenCalledTimes(2);
  });
});
