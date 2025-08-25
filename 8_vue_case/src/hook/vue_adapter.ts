import { shallowRef, onUnmounted, type Ref } from "vue";
import { createEffect, onCleanup } from "../core/effect.js";
import { computed as coreComputed } from "../core/computed.js";

type Readable<T> = { get(): T; peek(): T };

// 將 signal/computed 映射為 Vue ref（tear-free；由我們的 effect 推動）
export function useSignalRef<T>(src: Readable<T>): Ref<T> {
  const r = shallowRef<T>(src.peek()) as Ref<T>; // 初始快照（不追蹤）
  const stop = createEffect(() => {
    // 在追蹤上下文中讀取，值變動時同步寫入 Vue ref
    r.value = src.get();
    onCleanup(() => {
      // 可選：保留擴充（例如取消計時器），目前無需特別清理
    });
  });
  onUnmounted(() => stop()); // 元件卸載即解除訂閱
  return r;
}

// 在元件生命週期內建立你的 computed，並以 Vue ref 暴露 
export function useComputedRef<T>(
  fn: () => T,
  equals: (a: T, b: T) => boolean = Object.is
): Ref<T> {
  // 注意：fn 內要讀 signal.get() 才會建立依賴
  const memo = coreComputed(fn, equals);
  const r = useSignalRef<T>({ get: () => memo.get(), peek: () => memo.peek() });
  onUnmounted(() => memo.dispose?.());
  return r;
}
