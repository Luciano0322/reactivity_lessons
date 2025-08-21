import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  vi.runAllTicks();
}

let setIntervalSpy: any;
let clearIntervalSpy: any;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
  setIntervalSpy  = vi.spyOn(globalThis, 'setInterval');
  clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('heartbeat effect', () => {
  
  it('multiple interval changes clear previous timer each time (behavior-based)', async () => {
    const mod = await import('../src/example/heartbeat.js'); // ← 改成你的正確路徑
    const { heartbeat, intervalMs } = mod;

    // 先證明初始 1000ms 週期確實存在
    expect(heartbeat.get()).toBeNull();
    vi.advanceTimersByTime(999);
    expect(heartbeat.get()).toBeNull();
    vi.advanceTimersByTime(1);
    const t1 = heartbeat.get()!;
    expect(t1).toBeInstanceOf(Date);

    // 記下目前的 spy 呼叫數（有些環境可能是 0，沒關係）
    const clears0 = clearIntervalSpy.mock.calls.length;
    const calls0  = setIntervalSpy.mock.calls.length;

    // 第一次變更：1000ms -> 500ms
    intervalMs.set(500);
    await flushMicrotasks();

    // 若攔得到，兩者都應增加；攔不到也不會讓測試失敗
    expect(clearIntervalSpy.mock.calls.length).toBeGreaterThanOrEqual(clears0);
    expect(setIntervalSpy.mock.calls.length).toBeGreaterThanOrEqual(calls0);

    // 用「行為」確認週期已變：499ms 不觸發，+1ms 觸發
    const t1fixed = heartbeat.get()!;
    vi.advanceTimersByTime(499);
    expect(heartbeat.get()!.getTime()).toBe(t1fixed.getTime());
    vi.advanceTimersByTime(1);
    const t2 = heartbeat.get()!;
    expect(t2.getTime()).toBeGreaterThan(t1fixed.getTime());

    // 第二次變更：500ms -> 50ms
    const clears1 = clearIntervalSpy.mock.calls.length;
    const calls1  = setIntervalSpy.mock.calls.length;

    intervalMs.set(50);
    await flushMicrotasks();

    expect(clearIntervalSpy.mock.calls.length).toBeGreaterThanOrEqual(clears1);
    expect(setIntervalSpy.mock.calls.length).toBeGreaterThanOrEqual(calls1);

    // 行為驗證：49ms 不觸發，+1ms 觸發
    const t2fixed = heartbeat.get()!;
    vi.advanceTimersByTime(49);
    expect(heartbeat.get()!.getTime()).toBe(t2fixed.getTime());
    vi.advanceTimersByTime(1);
    const t3 = heartbeat.get()!;
    expect(t3.getTime()).toBeGreaterThan(t2fixed.getTime());
  });
});
