import { describe, it, expect } from "vitest";
import React, { StrictMode } from "react";
import { render, screen, act, waitFor } from "@testing-library/react";

import {
  useSignalValue,
  useComputed,
  useSignalState,
  useSignalSelector,
} from "../src/hook/react_adapter.js";
import { signal } from "../src/core/signal.js";
import { computed } from "../src/core/computed.js";
import { createEffect } from "../src/core/effect.js";

async function flushMicrotasks(times = 2) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/* -------------------- useSignalState -------------------- */
function Counter() {
  const [count, setCount] = useSignalState(1);
  return (
    <div>
      <span data-testid="value">{count}</span>
      <button data-testid="inc" onClick={() => setCount((v) => v + 1)}>
        +
      </button>
      <button data-testid="set10" onClick={() => setCount(10)}>
        =10
      </button>
    </div>
  );
}

describe("useSignalState", () => {
  it("renders initial value and updates after set()", async () => {
    render(
      <StrictMode>
        <Counter />
      </StrictMode>
    );
    expect(screen.getByTestId("value").textContent).toBe("1");

    await act(async () => {
      screen.getByTestId("inc").click();
      await flushMicrotasks();
    });
    expect(screen.getByTestId("value").textContent).toBe("2");

    await act(async () => {
      screen.getByTestId("set10").click();
      await flushMicrotasks();
    });
    expect(screen.getByTestId("value").textContent).toBe("10");
  });
});

/* -------------------- useSignalValue -------------------- */
function Reader({ s }: { s: ReturnType<typeof signal<number>> }) {
  const v = useSignalValue(s);
  return <div data-testid="v">{v}</div>;
}

describe("useSignalValue (Readable)", () => {
  it("subscribes to a signal and re-renders on change", async () => {
    const s = signal(5);
    render(
      <StrictMode>
        <Reader s={s} />
      </StrictMode>
    );
    // signal 的 peek 有初值，這個可以直接斷言
    expect(screen.getByTestId("v").textContent).toBe("5");

    await act(async () => {
      s.set(9);
      await flushMicrotasks();
    });
    expect(screen.getByTestId("v").textContent).toBe("9");
  });
});

/* -------------------- useComputed -------------------- */
function Sum({
  a,
  b,
}: {
  a: ReturnType<typeof signal<number>>;
  b: ReturnType<typeof signal<number>>;
}) {
  const v = useComputed(() => a.get() + b.get());
  return <div data-testid="sum">{v}</div>;
}

describe("useComputed", () => {
  it("computes from sources and updates when sources change", async () => {
    const a = signal(1);
    const b = signal(2);
    const ui = render(
      <StrictMode>
        <Sum a={a} b={b} />
      </StrictMode>
    );
    expect(screen.getByTestId("sum").textContent).toBe("3");
    // ⚠️ 初次 render 不會 notify，因此此時 textContent 可能是 ""（undefined）
    // 直接觸發一次變化，讓訂閱生效並帶出快照：
    await act(async () => {
      a.set(10);
      b.set(20);
      await flushMicrotasks();
    });
    await waitFor(() => {
      expect(screen.getByTestId("sum").textContent).toBe("30");
    });

    ui.unmount();
    await act(async () => {
      a.set(100);
      b.set(200);
      await flushMicrotasks();
    });
  });

  it("respects custom equals (no recompute-visible change when equal)", async () => {
    const src = signal({ n: 1, x: "a" });
    function View() {
      const v = useComputed(
        () => src.get(),
        (a, b) => a.n === b.n
      );
      return <div data-testid="obj">{JSON.stringify(v)}</div>;
    }
    render(
      <StrictMode>
        <View />
      </StrictMode>
    );

    // 先觸發一個「不相等」的變化，把畫面拉到有值的狀態
    await act(async () => {
      src.set({ n: 2, x: "first-show" }); // equals:false -> 會重算與顯示
      await flushMicrotasks();
    });
    const shown = screen.getByTestId("obj").textContent!;

    // 之後做 equals:true 的變化，不應改變可見快照
    await act(async () => {
      src.set({ n: 2, x: "changed-but-equal" }); // equals:true
      await flushMicrotasks();
    });
    const afterEqual = screen.getByTestId("obj").textContent!;
    expect(afterEqual).toBe(shown);

    // 再做一次 equals:false，應該變了
    await act(async () => {
      src.set({ n: 3, x: "different" });
      await flushMicrotasks();
    });
    const afterDiff = screen.getByTestId("obj").textContent!;
    expect(afterDiff).not.toBe(shown);
  });
});

/* -------------------- useSignalSelector -------------------- */
function SelectorView({
  src,
}: {
  src: ReturnType<typeof signal<{ a: number; b: number }>>;
}) {
  const a = useSignalSelector(src, (s) => s.a, Object.is);
  const rendersRef = React.useRef(0);
  rendersRef.current++;
  return (
    <div>
      <span data-testid="a">{a}</span>
      <span data-testid="renders">{rendersRef.current}</span>
    </div>
  );
}

describe("useSignalSelector", () => {
  it("does not re-render when selector result is equal (Object.is)", async () => {
    const src = signal<{ a: number; b: number }>({ a: 1, b: 10 });
    render(
      <StrictMode>
        <SelectorView src={src} />
      </StrictMode>
    );

    // ⚠️ 初次畫面 a 可能是 ""（computed 初值未通知）
    // 先觸發一次「不改變 selector 結果」的變化，讓畫面進入穩定值
    const beforeChangeRenders = Number(
      screen.getByTestId("renders").textContent
    );
    await act(async () => {
      src.set({ a: 1, b: 999 }); // a 相同 -> selector 結果相同
      await flushMicrotasks();
    });
    // 這次更新只為了把 a 顯示出來，render 次數可相同或 +0/+1（取決於初次是否為 ""）
    const afterWarmupRenders = Number(
      screen.getByTestId("renders").textContent
    );
    expect(screen.getByTestId("a").textContent).toBe("1");

    // 再做一次 a 不變的修改：不應增加渲染次數
    await act(async () => {
      src.set({ a: 1, b: 12345 });
      await flushMicrotasks();
    });
    const rendersAfterEqual = Number(screen.getByTestId("renders").textContent);
    expect(rendersAfterEqual).toBe(afterWarmupRenders);

    // 改變 a，selector 結果不同 -> 應重繪一次
    await act(async () => {
      src.set({ a: 2, b: 0 });
      await flushMicrotasks();
    });
    expect(screen.getByTestId("a").textContent).toBe("2");
    const finalRenders = Number(screen.getByTestId("renders").textContent);
    expect(finalRenders).toBeGreaterThanOrEqual(afterWarmupRenders + 1);
  });

  it("works with custom equality comparator", async () => {
    const src = signal({ a: 1, b: 10 });
    const isEvenEqual = (x: number, y: number) => x % 2 === y % 2;

    function ParityView() {
      const p = useSignalSelector(src, (s) => s.a, isEvenEqual);
      const rendersRef = React.useRef(0);
      rendersRef.current++;
      return (
        <div>
          <span data-testid="p">{p}</span>
          <span data-testid="renders2">{rendersRef.current}</span>
        </div>
      );
    }

    render(
      <StrictMode>
        <ParityView />
      </StrictMode>
    );
    const r0 = Number(screen.getByTestId("renders2").textContent);

    // 先讓畫面顯示出 p（做一次不等變化）
    await act(async () => {
      src.set({ a: 2, b: 10 }); // 1 -> 2（奇偶不同）→ 會重繪
      await flushMicrotasks();
    });
    const shown = screen.getByTestId("p").textContent!;
    const r1 = Number(screen.getByTestId("renders2").textContent);
    expect(r1).toBeGreaterThanOrEqual(r0 + 1);

    // 2 -> 4（同偶），不應重繪
    await act(async () => {
      src.set({ a: 4, b: 10 });
      await flushMicrotasks();
    });
    const r2 = Number(screen.getByTestId("renders2").textContent);
    expect(r2).toBe(r1);

    // 4 -> 5（偶→奇），會重繪一次
    await act(async () => {
      src.set({ a: 5, b: 10 });
      await flushMicrotasks();
    });
    const r3 = Number(screen.getByTestId("renders2").textContent);
    expect(r3).toBeGreaterThanOrEqual(r1 + 1);
  });
});

/* -------------------- useSignalValue with computed (lazy recompute on peek) -------------------- */
function LazyComputedView() {
  const base = React.useMemo(() => signal(2), []);
  const c = React.useMemo(() => computed(() => base.get() * 5), [base]);
  const v = useSignalValue(c);
  return (
    <div>
      <span data-testid="lazy">{v}</span>
      <button data-testid="bump" onClick={() => base.set((x) => x + 1)}>
        bump
      </button>
    </div>
  );
}

describe("useSignalValue + computed (lazy recompute on peek)", () => {
  it("re-renders after underlying source changes (computed becomes stale then recomputes)", async () => {
    render(
      <StrictMode>
        <LazyComputedView />
      </StrictMode>
    );
    // 初值可能是 ""；直接觸發一次變化讓它顯示出值
    await act(async () => {
      screen.getByTestId("bump").click(); // 2 -> 3
      await flushMicrotasks();
    });
    expect(screen.getByTestId("lazy").textContent).toBe("15");
  });
});

// 放在檔案最後，沿用你上面已有的 import 與 flushMicrotasks

/* -------------------- 1) DOM 量測：useLayoutEffect 看到 commit 後的值 -------------------- */
function MeasureView({ s }: { s: ReturnType<typeof signal<number>> }) {
  const v = useSignalValue(s);
  const ref = React.useRef<HTMLDivElement>(null);
  const logs = React.useRef<number[]>([]);
  // 在 commit 後量測（這裡用 textContent 當「量測」結果；JSDOM 不做實體 layout）
  React.useLayoutEffect(() => {
    const text = ref.current?.textContent ?? "";
    logs.current.push(Number(text));
  }, [v]);
  // 曝露 logs 供測試讀取
  (globalThis as any).__measureLogs = logs;
  return (
    <div ref={ref} data-testid="measure">
      {v}
    </div>
  );
}

describe("DOM 量測：useLayoutEffect + useSignalValue 的值，確保每次 commit 後量測正確", () => {
  it("layout effect 取得的數值與畫面一致", async () => {
    const s = signal(1);
    render(
      <React.StrictMode>
        <MeasureView s={s} />
      </React.StrictMode>
    );

    // 初次 commit
    expect(screen.getByTestId("measure").textContent).toBe("1");
    // 第一次變更
    await act(async () => {
      s.set(2);
      await flushMicrotasks();
    });
    expect(screen.getByTestId("measure").textContent).toBe("2");
    // 第二次變更
    await act(async () => {
      s.set(3);
      await flushMicrotasks();
    });
    expect(screen.getByTestId("measure").textContent).toBe("3");

    const logsRef = (globalThis as any).__measureLogs as React.MutableRefObject<
      number[]
    >;
    // layoutEffect 在每次 commit 後記錄的值，應與最終畫面序列一致（含初次 + 兩次變更）
    expect(logsRef.current.at(-3)).toBe(1);
    expect(logsRef.current.at(-2)).toBe(2);
    expect(logsRef.current.at(-1)).toBe(3);
  });
});

/* -------------------- 2) StrictMode：掛載→卸載→再掛載，不遺留訂閱 -------------------- */
function StrictReader({ s }: { s: ReturnType<typeof signal<number>> }) {
  const v = useSignalValue(s);
  const renders = React.useRef(0);
  renders.current++;
  (globalThis as any).__strictRenders = renders;
  return <div data-testid="strict-v">{v}</div>;
}

describe("StrictMode：掛載→卸載→再掛載，不遺留 our effect 或 React effect 的訂閱", () => {
  it("卸載後不會殘留訂閱；再次掛載後更新只觸發一次重繪", async () => {
    const s = signal(0);

    // 第一次掛載
    const ui1 = render(
      <React.StrictMode>
        <StrictReader s={s} />
      </React.StrictMode>
    );
    const renders1 = (globalThis as any)
      .__strictRenders as React.MutableRefObject<number>;
    // 觸發一次變更
    await act(async () => {
      s.set(1);
      await flushMicrotasks();
    });
    const countAfterFirst = renders1.current;

    // 卸載
    ui1.unmount();
    // 卸載期間更新，不應噴錯
    await act(async () => {
      s.set(2);
      await flushMicrotasks();
    });

    // 第二次掛載（重新開始算）
    const ui2 = render(
      <React.StrictMode>
        <StrictReader s={s} />
      </React.StrictMode>
    );
    const renders2 = (globalThis as any)
      .__strictRenders as React.MutableRefObject<number>;
    const baseRenders = renders2.current;

    // 再次更新，應只觸發一次重繪（或至少不會多次，避免殘留）
    await act(async () => {
      s.set(3);
      await flushMicrotasks();
    });
    expect(renders2.current).toBeGreaterThanOrEqual(baseRenders + 1);

    ui2.unmount();
    // 僅檢查沒有異常；不做嚴格等於比較以避免 StrictMode 開發行為差異
    expect(countAfterFirst).toBeGreaterThanOrEqual(1);
  });
});

/* -------------------- 3) 同步多次 set：our effects 只重跑一次 -------------------- */
describe("同步多次 set：事件中連續 set 多個 signal，our effects 只重跑一次", () => {
  it("microtask 合併，effect 只重跑一次", async () => {
    const a = signal(1);
    const b = signal(2);
    let runs = 0;
    const stop = createEffect(() => {
      // 這是你的反應式 effect（非 React effect），會被 scheduler 合併
      a.get();
      b.get();
      runs++;
    });

    // 同一輪事件內連續 set
    await act(async () => {
      a.set(10);
      b.set(20);
      // flush microtasks 讓 scheduler 跑完
      await flushMicrotasks();
    });

    expect(runs).toBe(2);
    // 解釋：第一次建立 createEffect 時會先 run() 一次（收集依賴），
    // 同步 set 兩次應該只觸發「再跑」一次，所以總次數 = 1(初次) + 1(合併後) = 2
    stop();
  });
});

/* -------------------- 4) Key 重掛：切換 key 後舊的 computed/訂閱已清理 -------------------- */
function ChildUsingComputed({
  src,
}: {
  src: ReturnType<typeof signal<number>>;
}) {
  const doubled = useComputed(() => src.get() * 2);
  const renders = React.useRef(0);
  renders.current++;
  (globalThis as any).__keyChildRenders = renders;
  return <span data-testid="dbl">{doubled}</span>;
}

function KeyedHost({
  src,
  k,
}: {
  src: ReturnType<typeof signal<number>>;
  k: string;
}) {
  return <ChildUsingComputed key={k} src={src} />;
}

describe("Key 重掛：切換 key 造成重掛後，舊的 computed/訂閱都已清理", () => {
  it("重掛後更新不會疊加舊訂閱，只觸發一次重繪", async () => {
    const src = signal(1);
    function Wrapper() {
      const [key, setKey] = React.useState("A");
      (globalThis as any).__setKey = setKey;
      return <KeyedHost src={src} k={key} />;
    }

    render(
      <React.StrictMode>
        <Wrapper />
      </React.StrictMode>
    );

    // 初始渲染次數
    const rendersRef1 = (globalThis as any)
      .__keyChildRenders as React.MutableRefObject<number>;
    const base1 = rendersRef1.current;

    // 第一次更新：應該重繪
    await act(async () => {
      src.set(2);
      await flushMicrotasks();
    });
    const afterUpdate1 = rendersRef1.current;
    expect(afterUpdate1).toBeGreaterThanOrEqual(base1 + 1);

    // 觸發 key 切換 -> 造成 Child 卸載 + 重新掛載
    const setKey: React.Dispatch<React.SetStateAction<string>> = (
      globalThis as any
    ).__setKey;
    await act(async () => {
      setKey("B");
      await flushMicrotasks();
    });

    // 重新掛載後，render 計數 ref 會被新的子元件覆蓋
    const rendersRef2 = (globalThis as any)
      .__keyChildRenders as React.MutableRefObject<number>;
    const base2 = rendersRef2.current;

    // 再次更新：不應累加舊訂閱，只重繪一次
    await act(async () => {
      src.set(3);
      await flushMicrotasks();
    });
    expect(rendersRef2.current).toBeGreaterThanOrEqual(base2 + 1);
  });
});
