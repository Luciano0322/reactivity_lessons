import { link, track, unlink, type Node } from "./graph.js";

type Comparator<T> = (a: T, b: T) => boolean;
const defaultEquals = Object.is;

export function signal<T>(initial: T, equals: Comparator<T> = defaultEquals) {
  // 單一節點 + 私有值
  const node: Node & { kind: 'signal'; value: T; equals: Comparator<T> } = {
    kind: 'signal',
    deps: new Set(), // 永遠保持空集合（由 link() 保證）
    subs: new Set(),
    value: initial,
    equals,
  };

  const get = () => {
    track(node);
    return node.value;
  };

  const set = (next: T | ((prev: T) => T)) => {
    const nxtVal = typeof next === 'function' ? (next as (p: T) => T)(node.value) : next;
    if (node.equals(node.value, nxtVal)) return;
    node.value = nxtVal;
    // 本篇只談訂閱建圖，不做 dirty/通知；下一篇再接續
  };

  // 事件式顯式訂閱（用來對照宣告式追蹤）；回傳取消訂閱
  const subscribe = (observer: Node) => {
    if (observer.kind === 'signal') {
      throw new Error('A signal cannot subscribe to another node');
    }
    link(observer, node);
    return () => unlink(observer, node);
  };

  return { get, set, subscribe };
}