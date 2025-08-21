import { signal } from "../core/signal.js";
import { createEffect, onCleanup } from "../core/effect.js";

export const intervalMs = signal(1000);
export const heartbeat = signal<Date | null>(null);

createEffect(() => {
  const ms = intervalMs.get(); // 依賴 signal
  const id = setInterval(() => {
    heartbeat.set(new Date()); // 寫回資料層
  }, ms);

  onCleanup(() => clearInterval(id)); // 下一次重跑前釋放
});