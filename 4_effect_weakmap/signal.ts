import { link, track, unlink, type Node } from "./graph.js";
import { WeakMapRegistry as Effects } from "./registry.js";

type Comparator<T> = (a: T, b: T) => boolean;
const defaultEquals = Object.is;

export function signal<T>(initial: T, equals: Comparator<T> = defaultEquals) {
  const node: Node & { kind: 'signal'; value: T; equals: Comparator<T> } = {
    kind: 'signal',
    deps: new Set(),
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

    for (const sub of node.subs) {
      if (sub.kind === 'effect') Effects.get(sub)?.schedule();
    }
  };

  const subscribe = (observer: Node) => {
    if (observer.kind === 'signal') {
      throw new Error('A signal cannot subscribe to another node');
    }
    link(observer, node);
    return () => unlink(observer, node);
  };

  return { get, set, subscribe };
}