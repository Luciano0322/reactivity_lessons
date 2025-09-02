import { markStale } from "./computed.js";
import type { Node } from "./graph.js";

export interface Schedulable { run(): void; disposed?: boolean }

export type InternalNode<T = unknown> = { value: T };

type WriteLog = Map<(Node & InternalNode<unknown>), unknown>;

const queue = new Set<Schedulable>();
let scheduled = false;

let batchDepth = 0;

let atomicDepth = 0;
const atomicLogs: WriteLog[] = [];

let muted = 0;

export function scheduleJob(job: Schedulable) {
  if (job.disposed) return;
  if (muted > 0) return; // 回滾/靜音期間不進隊列
  queue.add(job);
  if (!scheduled && batchDepth === 0) {
    scheduled = true;
    queueMicrotask(flushJobs);
  }
}

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

export function transaction<T>(fn: () => T): T;
export function transaction<T>(fn: () => Promise<T>): Promise<T>;
export function transaction<T>(fn: () => T | Promise<T>): T | Promise<T> {
  return atomic(fn);
}

export function inAtomic() {
  return atomicDepth > 0;
}

export function recordAtomicWrite<T>(node: Node & InternalNode<T>, prevValue: T) {
  const log = atomicLogs[atomicLogs.length - 1];
  if (!log) return;
  if (!log.has(node)) log.set(node, prevValue);
}

function writeNodeValue<T>(node: Node & InternalNode<T>, v: T) {
  if ("value" in node) (node as { value: T }).value = v;
}

function mergeChildIntoParent(child: WriteLog, parent: WriteLog) {
  for (const [node, prev] of child) {
    if (!parent.has(node)) parent.set(node, prev);
  }
}

export function atomic<T>(fn: () => T): T;
export function atomic<T>(fn: () => Promise<T>): Promise<T>;
export function atomic<T>(fn: () => T | Promise<T>): T | Promise<T> {
  batchDepth++;
  atomicDepth++;
  atomicLogs.push(new Map<(Node & InternalNode<unknown>), unknown>());

  const exitCommit = () => {
    const log = atomicLogs.pop()!;
    atomicDepth--;
    if (atomicDepth > 0) {
      mergeChildIntoParent(log, atomicLogs[atomicLogs.length - 1]!);
    }
    batchDepth--;
    if (batchDepth === 0) flushJobs();
  };

  const exitRollback = () => {
    const log = atomicLogs.pop()!;
    atomicDepth--;
    muted++;
    try {
      for (const [node, prev] of log) {
        writeNodeValue(node, prev);
        if ((node as Node).kind === "signal") {
          for (const sub of (node as Node).subs) {
            if (sub.kind === "computed") markStale(sub);
          }
        }
      }
      queue.clear();
      scheduled = false;
    } finally {
      muted--;
    }
    batchDepth--;
  };

  try {
    const out = fn();
    if (isPromiseLike<T>(out)) {
      return Promise.resolve(out).then(
        (v) => { exitCommit(); return v; },
        (err) => { exitRollback(); throw err; }
      );
    }
    exitCommit();
    return out as T;
  } catch (e) {
    exitRollback();
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
