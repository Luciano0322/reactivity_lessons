import { markStale } from "./computed.js";
import type { Node } from "./graph.js";

export interface Schedulable { run(): void; disposed?: boolean }

// signal/computed 內部節點
export type InternalNode<T = unknown> = { value: T };

// 原子交易寫入日誌（首見去重 + 可迭代回滾）
type WriteLog = Map<(Node & InternalNode<unknown>), unknown>;

const queue = new Set<Schedulable>();
let scheduled = false;

// >0 代表在批次/交易中（延後 microtask）
let batchDepth = 0;

// 原子交易層級與日誌堆疊
let atomicDepth = 0;
const atomicLogs: WriteLog[] = [];

// 回滾時暫停排程，避免 scheduleJob 產生新的工作 
let muted = 0;

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
  batchDepth++;
  try {
    const out = fn();
    if (isPromiseLike<T>(out)) {
      return Promise.resolve(out).finally(() => {
        batchDepth--;
        if (batchDepth === 0) flushJobs();
      });
    }
    batchDepth--;
    if (batchDepth === 0) flushJobs();
    return out as T;
  } catch (e) {
    batchDepth--;
    if (batchDepth === 0) flushJobs();
    throw e;
  }
}

// 原子交易（帶回滾）
export function inAtomic() {
  return atomicDepth > 0;
}

// 記錄「本層第一次寫入」的舊值；由 signal.set() 在確定要寫入時呼叫
export function recordAtomicWrite<T>(node: Node & InternalNode<T>, prevValue: T) {
  const log = atomicLogs[atomicLogs.length - 1];
  if (!log) return; // 防呆：沒有 active atomic 層
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
  // 進入原子層：抑制 flush（共用 batchDepth），開始記錄寫入
  batchDepth++;
  atomicDepth++;
  atomicLogs.push(new Map<(Node & InternalNode<unknown>), unknown>());

  const exitCommit = () => {
    const log = atomicLogs.pop()!;
    atomicDepth--;
    // 內層成功 → 合併「首見舊值」到父層
    if (atomicDepth > 0) {
      mergeChildIntoParent(log, atomicLogs[atomicLogs.length - 1]!);
    }
    // 最外層退出才 flush
    batchDepth--;
    if (batchDepth === 0) flushJobs();
  };

  const exitRollback = () => {
    const log = atomicLogs.pop()!;
    atomicDepth--;
    // 靜音回寫：避免在回滾過程再排程
    muted++;
    try {
      for (const [node, prev] of log) {
        writeNodeValue(node, prev);
        if ((node as Node).kind === "signal") {
          for (const sub of (node as Node).subs) {
            if (sub.kind === "computed") markStale(sub);
            // sub.kind === "effect" 不必 schedule（muted 會擋 & 稍後也不 flush）
          }
        }
      }
      queue.clear(); // 清掉這層期間的任務
      scheduled = false;
    } finally {
      muted--;
    }
    // 失敗不 flush；僅退出 batch/atomic 層級
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
    // 同步成功
    exitCommit();
    return out as T;
  } catch (e) {
    // 同步失敗 → 回滾
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
