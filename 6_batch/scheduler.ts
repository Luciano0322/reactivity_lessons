export interface Schedulable { run(): void; disposed?: boolean }

const queue = new Set<Schedulable>();
let scheduled = false;
let batchDepth = 0;

/** 將工作加入佇列；若不在 batch 中，排到下一個 microtask 一起執行 */
export function scheduleJob(job: Schedulable) {
  if (job.disposed) return;
  queue.add(job);
  if (!scheduled && batchDepth === 0) {
    scheduled = true;
    queueMicrotask(flushJobs);
  }
}

/** 把一段更新合併成一次副作用重跑 */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try { return fn(); }
  finally {
    batchDepth--;
    if (batchDepth === 0) flushJobs();
  }
}

/** 立即清空佇列（測試或特別需求） */
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
