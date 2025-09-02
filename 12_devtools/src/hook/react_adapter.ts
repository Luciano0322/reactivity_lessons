import { useEffect, useMemo, useSyncExternalStore, useRef } from "react";
import { createEffect } from "../core/effect.js";
import { computed } from "../core/computed.js";
import { signal } from "../core/signal.js";

type Readable<T> = { get(): T; peek(): T };

function subscribeReadable<T>(src: Readable<T>, notify: () => void) {
  let first = true;
  const stop = createEffect(() => {
    src.get();
    if (first) { first = false; return; }
    notify();
  });
  return () => stop();
}

export function useSignalValue<T>(src: Readable<T>) {
  const getSnapshot = () => src.peek();
  return useSyncExternalStore(
    (notify) => subscribeReadable(src, notify),
    getSnapshot,
    getSnapshot
  );
}

export function useComputed<T>(
  fn: () => T,
  equals: (a: T, b: T) => boolean = Object.is
) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const eqRef = useRef(equals);
  eqRef.current = equals;

  const memo = useMemo(() => {
    const c = computed(
      () => fnRef.current(),
      (a, b) => eqRef.current(a, b)
    );
    c.get();
    return c;
  }, []);

  useEffect(() => () => memo.dispose?.(), [memo]);

  return useSignalValue(memo);
}

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

  const memo = useMemo(() => {
    const c = computed(
      () => selectorRef.current(src.get()),
      (a, b) => eqRef.current(a, b)
    );
    c.get();
    return c;
  }, [src]);

  useEffect(() => () => memo.dispose?.(), [memo]);

  return useSignalValue(memo);
}
