import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---- 先準備 mocks（要在 import 被測模組「之前」宣告） ----
// computed.js
vi.mock("../src/core/computed.js", () => ({
  markStale: vi.fn(),
}));

// devtools/hotspot.js
const registerNodeMock = vi.fn();
const recordUpdateMock = vi.fn();
vi.mock("../src/core/devtools/hotspot.js", () => ({
  registerNode: registerNodeMock,
  recordUpdate: recordUpdateMock,
}));

// graph.js：最小可用的連結/追蹤實作
type TestNode = {
  kind: "signal" | "computed" | "effect";
  deps: Set<TestNode>;
  subs: Set<TestNode>;
};
vi.mock("../src/core/graph.js", () => {
  const link = (observer: TestNode, subject: TestNode) => {
    subject.subs.add(observer);
    observer.deps.add(subject);
  };
  const unlink = (observer: TestNode, subject: TestNode) => {
    subject.subs.delete(observer);
    observer.deps.delete(subject);
  };
  const track = (_n: TestNode) => {}; // 測試不需要真正追蹤
  return { link, unlink, track };
});

// registry.js：Effect 調度器不介入這組測試
vi.mock("../src/core/registry.js", () => ({
  SymbolRegistry: new Map(), // Effects
}));

// scheduler.js：不進入 atomic
vi.mock("../src/core/scheduler.js", async () => {
  return {
    inAtomic: () => false,
    recordAtomicWrite: (_node: unknown, _prev: unknown) => {},
  };
});

beforeEach(() => {
  vi.resetModules(); // 讓每個測試都重新載入被測模組與 mocks 綁定
  registerNodeMock.mockClear();
  recordUpdateMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("signal + hotspot integration", () => {
  it("建立 signal 時會呼叫 registerNode(node)，node.kind = 'signal'", async () => {
    const { signal } = await import("../src/core/signal.js");
    const s = signal("Hello"); // 這一行應觸發 registerNode

    expect(registerNodeMock).toHaveBeenCalled();
    expect(registerNodeMock).toHaveBeenCalledTimes(1);
    const node = registerNodeMock.mock.calls[0]![0];
    // 基本形狀檢查
    expect(node && typeof node).toBe("object");
    expect(node.kind).toBe("signal");
    expect(node.deps instanceof Set).toBe(true);
    expect(node.subs instanceof Set).toBe(true);

    // 也驗證 get/peek 行為沒有壞掉
    expect(s.peek()).toBe("Hello");
    expect(typeof s.get).toBe("function");
    expect(typeof s.set).toBe("function");
    expect(typeof s.subscribe).toBe("function");
  });

  it("set() 成功變更值時會呼叫 recordUpdate(node)，且與 registerNode 的 node 為同一個", async () => {
    const { signal } = await import("../src/core/signal.js");
    const s = signal("Hello");

    registerNodeMock.mockClear(); // 只觀察這次 set
    recordUpdateMock.mockClear();

    s.set("World");

    expect(recordUpdateMock).toHaveBeenCalledTimes(1);
    const updatedNode = recordUpdateMock.mock.calls[0]![0];
    // 這個 node 應該就是先前 registerNode 傳入的那個
    // 為了拿到它，我們重建一次（因為上面被清掉了），或在建立前先存下：
    // 解法：不清 registerNode，直接比較：
  });

  it("（嚴格比對）recordUpdate 的參數就是同一個 node 實例", async () => {
    const { signal } = await import("../src/core/signal.js");
    registerNodeMock.mockClear();
    recordUpdateMock.mockClear();

    const s = signal("A");
    // 建立當下調到一次 registerNode
    expect(registerNodeMock).toHaveBeenCalled();
    expect(registerNodeMock).toHaveBeenCalledTimes(1);
    const regNode = registerNodeMock.mock.calls[0]![0];

    s.set("B");
    expect(recordUpdateMock).toHaveBeenCalledTimes(1);
    const recNode = recordUpdateMock.mock.calls[0]![0];

    expect(recNode).toBe(regNode); // 同一個物件實例
    expect(recNode.kind).toBe("signal");
    expect(s.peek()).toBe("B");
  });

  it("值未變（Object.is 相等）時不會呼叫 recordUpdate", async () => {
    const { signal } = await import("../src/core/signal.js");
    const s = signal("X");
    recordUpdateMock.mockClear();

    s.set("X"); // 相等，應該不觸發
    expect(recordUpdateMock).not.toHaveBeenCalled();
    expect(s.peek()).toBe("X");
  });

  it("自訂 comparator 判相等時，不會呼叫 recordUpdate", async () => {
    const { signal } = await import("../src/core/signal.js");
    // comparator：只看奇偶，偶數視為相等
    const evenEqual = (a: number, b: number) => (a % 2) === (b % 2);
    const s = signal(2, evenEqual);
    recordUpdateMock.mockClear();

    s.set(4); // 同為偶數 → 視為相等，不觸發
    expect(recordUpdateMock).not.toHaveBeenCalled();
    expect(s.peek()).toBe(2);

    s.set(5); // 2 → 5（偶→奇）→ 觸發
    expect(recordUpdateMock).toHaveBeenCalledTimes(1);
    expect(s.peek()).toBe(5);
  });

  it("subscribe() 不影響 hotspot 行為：只有在 set 且值改變時才會記錄", async () => {
    const { signal } = await import("../src/core/signal.js");
    const s = signal(0);
    const dummyObserver = { kind: "computed", deps: new Set(), subs: new Set() } as any;

    // 建立訂閱
    const unsubscribe = s.subscribe(dummyObserver);
    expect(typeof unsubscribe).toBe("function");

    recordUpdateMock.mockClear();
    s.set(1);
    s.set(1); // 相等，不應再記錄

    expect(recordUpdateMock).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
