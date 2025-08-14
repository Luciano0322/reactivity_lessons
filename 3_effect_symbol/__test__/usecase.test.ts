import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEffect } from '../effect.js';
import { signal } from '../signal.js';

// 小工具：flush microtasks（queueMicrotask / Promise jobs）
async function flushMicrotasks(times = 2) {
  // 兩次通常足夠，必要時可增加
  for (let i = 0; i < times; i++) await Promise.resolve();
}

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
});

describe('signal + createEffect demo', () => {
  it('runs effect immediately with initial sum', () => {
    const a = signal(1);
    const b = signal(2);

    const stop = createEffect(() => {
      console.log('sum =', a.get() + b.get());
    });

    // createEffect 會立刻 run 一次
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenLastCalledWith('sum =', 3);

    stop();
  });

  it('batches multiple set() in the same tick (one extra run with latest values)', async () => {
    const a = signal(1);
    const b = signal(2);

    const stop = createEffect(() => {
      console.log('sum =', a.get() + b.get());
    });

    // 清掉第一次立即執行的呼叫紀錄，專注後續調度
    logSpy.mockClear();

    // 同一個 tick 內連續 set，應只觸發一次微任務執行，拿到最終值
    a.set(10);
    b.set(20);

    await flushMicrotasks();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenLastCalledWith('sum =', 30);

    stop();
  });

  it('runs again across ticks (separate schedules produce separate runs)', async () => {
    const a = signal(1);
    const b = signal(2);

    const stop = createEffect(() => {
      console.log('sum =', a.get() + b.get());
    });

    logSpy.mockClear();

    // 不同 tick 觸發：先改 a -> flush -> 再改 b -> 再 flush
    a.set(5);
    await flushMicrotasks();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenLastCalledWith('sum =', 7);

    b.set(9);
    await flushMicrotasks();
    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenLastCalledWith('sum =', 14);

    stop();
  });

  it('stop() disposes effect: further set() do not trigger runs', async () => {
    const a = signal(1);
    const b = signal(2);

    const stop = createEffect(() => {
      console.log('sum =', a.get() + b.get());
    });

    logSpy.mockClear();

    stop(); // 解除 effect

    a.set(100);
    b.set(200);

    await flushMicrotasks();

    expect(logSpy).not.toHaveBeenCalled();
  });
});
