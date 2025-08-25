export interface Schedulable { run(): void; disposed?: boolean }

const queue = new Set<Schedulable>();
let scheduled = false;
let batchDepth = 0;

export function scheduleJob(job: Schedulable) {
  if (job.disposed) return;
  queue.add(job);
  if (!scheduled && batchDepth === 0) {
    scheduled = true;
    queueMicrotask(flushJobs);
  }
}

export function batch<T>(fn: () => T): T {
  batchDepth++;
  try { return fn(); }
  finally {
    batchDepth--;
    if (batchDepth === 0) flushJobs();
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
