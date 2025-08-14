import { unlink, withObserver, type Node } from "./graph.js";
import { SymbolRegistry as Effects, type EffectInstanceLike } from "./registry.js";

type Cleanup = () => void;
// 共用工具：LIFO 執行，確保最後清空
function drainCleanups(list: Cleanup[], onError?: (err: unknown) => void) {
  // LIFO：從尾到頭執行
  for (let i = list.length - 1; i >= 0; i--) {
    const cb = list[i];
    try {
      cb?.();
    } catch (e) {
      onError?.(e);
    }
  }
  list.length = 0;
}

// microtask 合併
const pending = new Set<EffectInstance>();
let scheduled = false;
function schedule(inst: EffectInstance) {
  if (inst.disposed) return;
  pending.add(inst);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const list = Array.from(pending);
      pending.clear();
      for (const ef of list) ef.run();
    });
  }
}

let activeEffect: EffectInstance | null = null;
export function onCleanup(cb: Cleanup) {
  if (activeEffect) activeEffect.cleanups.push(cb);
}

export class EffectInstance implements EffectInstanceLike {
  node: Node = {
    kind: 'effect',
    deps: new Set(),
    subs: new Set()
  };
  cleanups: Cleanup[] = [];
  disposed = false;

  constructor(private fn: () => void | Cleanup) {
    Effects.set(this.node, this); // 只碰 Registry
  }

  run() {
    if (this.disposed) return;
    
    // 1) 清理上次
    drainCleanups(this.cleanups);

    // 2) 解除舊依賴
    for (const dep of [...this.node.deps]) unlink(this.node, dep);

    // 3) 追蹤上下文執行，收集新依賴；支援回傳 cleanup
    activeEffect = this;
    try {
      const ret = withObserver(this.node, this.fn);
      if (typeof ret === 'function') this.cleanups.push(ret);
    } finally {
      activeEffect = null;
    }
  }

  schedule() { schedule(this); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    drainCleanups(this.cleanups);
    for (const dep of [...this.node.deps]) unlink(this.node, dep);
    this.node.deps.clear();

    Effects.delete(this.node); // 只碰 Registry
  }
}

export function createEffect(fn: () => void | Cleanup) {
  const inst = new EffectInstance(fn);
  inst.run(); // 先跑一次收集依賴
  return () => inst.dispose();
}