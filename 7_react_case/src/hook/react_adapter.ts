import { useEffect, useMemo, useSyncExternalStore, useRef } from "react";
import { createEffect } from "../core/effect.js";
import { computed } from "../core/computed.js";
import { signal } from "../core/signal.js";

type Readable<T> = { get(): T; peek(): T };

function subscribeReadable<T>(src: Readable<T>, notify: () => void) {
  // 用前面章節的反應式 effect 訂閱來源；首次執行不通知，避免 render 期 setState
  let first = true;
  const stop = createEffect(() => {
    src.get(); // 追蹤依賴
    if (first) { first = false; return; }
    notify(); // 後續變化才通知 React 重取快照
  });
  return () => stop(); // useSyncExternalStore 會在卸載或重掛時呼叫
}

export function useSignalValue<T>(src: Readable<T>) {
  const getSnapshot = () => src.peek(); // 不追蹤，但 stale 時會 lazy 重算
  return useSyncExternalStore(
    (notify) => subscribeReadable(src, notify),
    getSnapshot, // client snapshot
    getSnapshot  // server snapshot（SSR）
  );
}

export function useComputed<T>(
  fn: () => T,
  equals: (a: T, b: T) => boolean = Object.is
) {
  // 用 ref 持有最新的 fn / equals，避免因函式 identity 改變而重建 computed
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const eqRef = useRef(equals);
  eqRef.current = equals;

  // 只建一次 computed；其內部每次取值都使用最新的 fn/equals
  const memo = useMemo(() => {
    const c = computed(
      () => fnRef.current(),
      (a, b) => eqRef.current(a, b)
    );
    // 暖機：讓 peek() 初次就有快照
    c.get();
    return c;
  }, []);

  // 卸載清理
  useEffect(() => () => memo.dispose?.(), [memo]);

  // 用你原來的機制訂閱（首次不 notify 也沒關係，因為我們已經暖機）
  return useSignalValue(memo);
}

// React 風格的 signal 狀態
export function useSignalState<T>(initial: T) {
  const sig = useMemo(() => signal<T>(initial), []);
  const value = useSignalValue(sig);
  return [value, sig.set] as const;
}

export function useSignalSelector<S, T>(
  src: Readable<S>,
  selector: (s: S) => T,
  isEqual: (a: T, b: T) => boolean = Object.is
) {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const eqRef = useRef(isEqual);
  eqRef.current = isEqual;

  // src 變了才重建；其餘都用 ref 讀「最新」的 selector/isEqual
  const memo = useMemo(() => {
    const c = computed(
      () => selectorRef.current(src.get()),
      (a, b) => eqRef.current(a, b)
    );
    // 暖機
    c.get();
    return c;
  }, [src]);

  useEffect(() => () => memo.dispose?.(), [memo]);

  return useSignalValue(memo);
}
