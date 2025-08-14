export type Kind = 'signal' | 'computed' | 'effect';

export interface Node {
  kind: Kind;
  deps: Set<Node>; // 我依賴了誰（effect / computed）
  subs: Set<Node>; // 誰依賴我（signal / computed）
}

export function link(from: Node, to: Node) {
  if (from.kind === 'signal') throw new Error('Signal nodes cannot depend on others');
  from.deps.add(to);
  to.subs.add(from);
}

export function unlink(from: Node, to: Node) {
  from.deps.delete(to);
  to.subs.delete(from);
}

// 追蹤：在觀察者上下文中讀取，會自動建邊界 Observer -> Trackable
let currentObserver: Node | null = null;

export function withObserver<T>(obs: Node, fn: () => T): T {
  const prev = currentObserver;
  currentObserver = obs;
  try {
    return fn();
  } finally { 
    currentObserver = prev;
  }
}

export function track(dep: Node) {
  if (!currentObserver) return;
  link(currentObserver, dep);
}
