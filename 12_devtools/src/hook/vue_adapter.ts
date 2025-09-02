import { shallowRef, onUnmounted, type Ref } from "vue";
import { createEffect, onCleanup } from "../core/effect.js";
import { computed as coreComputed } from "../core/computed.js";

type Readable<T> = { get(): T; peek(): T };

export function useSignalRef<T>(src: Readable<T>): Ref<T> {
  const r = shallowRef<T>(src.peek()) as Ref<T>;
  const stop = createEffect(() => {
    r.value = src.get();
  });
  onUnmounted(() => stop());
  return r;
}

export function useComputedRef<T>(
  fn: () => T,
  equals: (a: T, b: T) => boolean = Object.is
): Ref<T> {
  const memo = coreComputed(fn, equals);
  const r = useSignalRef<T>({ get: () => memo.get(), peek: () => memo.peek() });
  onUnmounted(() => memo.dispose?.());
  return r;
}
