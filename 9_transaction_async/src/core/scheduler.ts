export interface Schedulable { run(): void; disposed?: boolean }

const queue = new Set<Schedulable>();
let scheduled = false;
let batchDepth = 0;

export function scheduleJob(job: Schedulable) {
  if (job.disposed) return;
  queue.add(job);
  // 只有在「不在批次/交易中」才安排 microtask
  if (!scheduled && batchDepth === 0) {
    scheduled = true;
    queueMicrotask(flushJobs);
  }
}

// 與原本相同：同步區塊合併，結尾 flush 一次
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) flushJobs();
  }
}

// Promise 判斷
function isPromiseLike<T = unknown>(v: any): v is PromiseLike<T> {
  return v != null && typeof v.then === "function";
}

// 新增：支援 async 的交易；跨 await 合併，最外層結束時 flush 一次
export function transaction<T>(fn: () => T): T;
export function transaction<T>(fn: () => Promise<T>): Promise<T>;
export function transaction<T>(fn: () => T | Promise<T>): T | Promise<T> {
  batchDepth++;
  try {
    const out = fn();
    if (isPromiseLike<T>(out)) {
      // 非同步：等 fn 完成（成功/失敗）後再出站並視需要 flush
      return Promise.resolve(out).finally(() => {
        batchDepth--;
        if (batchDepth === 0) flushJobs();
      });
    }
    // 同步：直接出站並視需要 flush
    batchDepth--;
    if (batchDepth === 0) flushJobs();
    return out as T;
  } catch (e) {
    // 例外也要正確出站並做一次 flush
    batchDepth--;
    if (batchDepth === 0) flushJobs();
    throw e;
  }
}

export function flushSync() {
  if (!scheduled && queue.size === 0) return;
  flushJobs();
}

function flushJobs() {
  scheduled = false;
  let guard = 0;
  while (queue.size) {
    const list = Array.from(queue);
    queue.clear();
    for (const job of list) job.run();
    if (++guard > 10000) throw new Error("Infinite update loop");
  }
}
