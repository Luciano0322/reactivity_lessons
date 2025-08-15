import { unlink, withObserver, track, type Node } from "./graph.js";
import { SymbolRegistry as Effects } from "./registry.js";

type Comparator<T> = (a: T, b: T) => boolean;
const defaultEquals = Object.is;

/** 供 signal.set() 與其它 computed 標髒使用 */
export function markStale(node: Node) {
  if (node.kind !== "computed") return;
  const c = node as Node & { stale: boolean };
  if (c.stale) return; // 已經髒就別重複傳染
  c.stale = true;

  // 向下傳染：讓依賴此 computed 的節點一併反應
  for (const sub of node.subs) {
    if (sub.kind === "computed") {
      markStale(sub); // 傳染給下游 computed（多層）
    } else if (sub.kind === "effect") {
      Effects.get(sub)?.schedule(); // 讓 effect 排進 microtask
    }
  }
}

export function computed<T>(
  fn: () => T,
  equals: Comparator<T> = defaultEquals
) {
  const node: Node & {
    kind: "computed";
    value: T;
    stale: boolean;
    equals: Comparator<T>;
    computing: boolean;
    hasValue: boolean;
  } = {
    kind: "computed",
    deps: new Set(),
    subs: new Set(),
    value: undefined as unknown as T,
    stale: true, // 第一次讀時要算
    equals,
    computing: false,
    hasValue: false,
  };

  function recompute() {
    if (node.computing) throw new Error("Cycle detected in computed");
    node.computing = true;

    // 解除舊依賴
    for (const d of [...node.deps]) unlink(node, d);

    // 在追蹤上下文中計算，過程中讀到誰就自動 link(node → dep)
    const next = withObserver(node, fn);

    if (!node.hasValue || !node.equals(node.value, next)) {
      node.value = next;
      node.hasValue = true;
    }
    node.stale = false;
    node.computing = false;
  }

  const get = () => {
    track(node); // 讓觀察者（effect / computed）能訂閱我
    if (node.stale || !node.hasValue) recompute();
    return node.value;
  };

  const peek = () => node.value;

  const dispose = () => {
    // 解除與所有上/下游關係（謹慎：可能讓下游失去依賴，屬預期）
    for (const d of [...node.deps]) unlink(node, d);
    for (const s of [...node.subs]) unlink(s, node);
    node.deps.clear();
    node.subs.clear();
    node.stale = true;
    node.hasValue = false;
  };

  // peek, dispose, _node 都是為了測試方便，正常情況下 computed 只要回傳 get 的方法就好
  return { get, peek, dispose, _node: node };
}
