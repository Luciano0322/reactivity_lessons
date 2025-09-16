import { markStale } from "./computed.js";
import type { Node } from "./graph.js";

export interface Schedulable { run(): void; disposed?: boolean };

type JobKind = 'computed' | 'effect';

export interface Job extends Schedulable {
  kind?: JobKind;        // 'computed' | 'effect'；預設 'effect'
  priority?: number;     // 數字越小越優先；預設 0
  dependsOn?: Set<Job>;  // 【重點】本輪 flush 內必須先跑的上游 job（局部 DAG）
  // 下列欄位僅在 flush 期間使用
  __indegree__?: number;
  __enq__?: number;
}

export type InternalNode<T = unknown> = { value: T };

type WriteLog = Map<(Node & InternalNode<unknown>), unknown>;

// ========== 狀態 ==========
const allJobs = new Set<Job>(); // 本輪待排程的 job（computed/effect 混合）

let scheduled = false;
let batchDepth = 0;

let atomicDepth = 0;
const atomicLogs: WriteLog[] = [];

let muted = 0;

let tick = 0; // 防飢餓用

// adjust for two queue
export function scheduleJob(job: Schedulable) {
  const j = job as Job;
  if (j.disposed) return;
  if (muted > 0) return; // 回滾/靜音期間不進隊列
  allJobs.add(j);
  if (!scheduled && batchDepth === 0) {
    scheduled = true;
    queueMicrotask(flushJobsTopo);
  }
}

//（選用）若你在建立 job 後才知道依賴，可呼叫這個 helper 追加
export function setJobDeps(job: Job, deps: Iterable<Job>) {
  if (job.disposed) return;
  if (!job.dependsOn) job.dependsOn = new Set();
  for (const d of deps) if (d !== job) job.dependsOn.add(d);
}

export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) flushJobsTopo();
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
    if (batchDepth === 0) flushJobsTopo();
  };

  const exitRollback = () => {
    const log = atomicLogs.pop()!;
    atomicDepth--;
    muted++;
    try {
      // 回寫舊值 + 標髒下游 computed
      for (const [node, prev] of log) {
        writeNodeValue(node, prev);
        if ((node as Node).kind === "signal") {
          for (const sub of (node as Node).subs) {
            if (sub.kind === "computed") markStale(sub);
          }
        }
      }
      allJobs.clear();
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
  if (!scheduled && allJobs.size === 0) return;
  flushJobsTopo();
}

// ========== 拓撲 + 權重實作 ==========
class MinHeap<T extends NonNullable<unknown>> {
  private a: T[] = [];
  constructor(private less: (x: T, y: T) => boolean) {}

  get size(): number { return this.a.length; }

  push(v: T): void {
    this.a.push(v);
    this.up(this.a.length - 1);
  }

  pop(): T | undefined {
    const n = this.a.length;
    if (n === 0) return undefined;

    const top = this.a[0] as T;      // n>0，root 存在
    const last = this.a.pop() as T;  // n>0，pop 一定回 T

    if (n > 1) {                     // 只有多於一個元素才覆蓋 root
      this.a[0] = last;
      this.down(0);
    }
    return top;
  }

  // ---- helpers ----
  private at(i: number): T {
    // 呼叫點都做了邊界檢查；這裡集中 non-null 斷言
    return this.a[i] as T;
  }

  private up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(this.at(i), this.at(p))) break;

      // ⚠️ 不用解構；用暫存變數把型別收斂成 T
      const ai = this.at(i);
      const ap = this.at(p);
      this.a[i] = ap;
      this.a[p] = ai;

      i = p;
    }
  }

  private down(i: number): void {
    const n = this.a.length;
    while (true) {
      const l = (i << 1) + 1;
      const r = l + 1;
      let m = i;

      if (l < n && this.less(this.at(l), this.at(m))) m = l;
      if (r < n && this.less(this.at(r), this.at(m))) m = r;
      if (m === i) break;

      const ai = this.at(i);
      const am = this.at(m);
      this.a[i] = am;
      this.a[m] = ai;

      i = m;
    }
  }
}


function phaseWeight(j: Job) {
  // 預設：computed(0) 先於 effect(1)
  return (j.kind ?? 'effect') === 'computed' ? 0 : 1;
}

function flushJobsTopo() {
  scheduled = false;
  if (allJobs.size === 0) return;

  // 1) 建入度（僅針對本輪 allJobs 的局部 DAG）
  for (const j of allJobs) j.__indegree__ = 0;
  for (const j of allJobs) {
    if (!j.dependsOn) continue;
    for (const d of j.dependsOn) {
      if (allJobs.has(d)) j.__indegree__!++;
    }
  }

  // 2) ready-heap：只放入度 0 的 job；以 (phase, priority, enq) 排序
  const heap = new MinHeap<Job>((a, b) => {
    const ap = phaseWeight(a);
    const bp = phaseWeight(b);
    if (ap !== bp) return ap < bp;

    const apri = a.priority ?? 0;
    const bpri = b.priority ?? 0;
    if (apri !== bpri) return apri < bpri;

    const aenq = a.__enq__ ?? 0;
    const benq = b.__enq__ ?? 0;
    return aenq < benq;
  });

  for (const j of allJobs) {
    if ((j.__indegree__ ?? 0) === 0) {
      j.__enq__ = tick++;
      heap.push(j);
    }
  }

  let processed = 0;
  let guard = 0;

  while (heap.size) {
    if (++guard > 10000) throw new Error("Infinite update loop (topo)");
    const j = heap.pop()!;
    allJobs.delete(j);
    j.run();
    processed++;

    // 3) 鬆弛：找依賴 j 的節點入度 -1
    for (const k of allJobs) {
      if (k.dependsOn?.has(j)) {
        k.__indegree__!--;
        if (k.__indegree__ === 0) {
          k.__enq__ = tick++;
          heap.push(k);
        }
      }
    }
  }

  // 4) 若一個都沒跑但還有 job → 可能循環 / 依賴未宣告，fallback 以免卡死
  if (processed === 0 && allJobs.size) {
    const rest = Array.from(allJobs);
    allJobs.clear();
    for (const j of rest) j.run();
  }

  // 5) 如果 run() 過程又 enqueue 新 job，安排下一輪
  if (allJobs.size) {
    scheduled = true;
    queueMicrotask(flushJobsTopo);
  }
}
