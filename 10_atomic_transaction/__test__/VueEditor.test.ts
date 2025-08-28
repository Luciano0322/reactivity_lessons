import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, within, fireEvent } from "@testing-library/vue";
import { nextTick } from "vue";

// ✅ browser runner 需要的小 shim（讓 fireEvent 讀得到 process.env）
(globalThis as any).process ||= { env: { NODE_ENV: "test" } };

const flushMicrotasks = async (n = 2) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

function queriesOf(container: HTMLElement) {
  const q = within(container.querySelector("section") as HTMLElement);
  return {
    input: () => q.getByRole("textbox") as HTMLInputElement,
    saveBtn: () => q.getByRole("button", { name: /save|saving/i }),
    failToggle: () => q.getByRole("checkbox") as HTMLInputElement,
    committed: () => q.getByText(/Committed title:/),
    derivedLen: () => q.getByText(/Derived length/),
    error: () => q.queryByText(/Error:/),
  };
}

describe("Vue Editor (atomic optimistic save) — pending 不 flush", () => {
  beforeEach(() => {
    vi.resetModules();      // 重要：重置 module cache，避免 signal 狀態殘留
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("successful save", async () => {
    const { default: Editor } = await import("../src/example/VueEditor.vue");
    const { container } = render(Editor);
    const ui = queriesOf(container as unknown as HTMLElement);

    // 初始
    expect(ui.input().value).toBe("Hello");
    expect(ui.committed().textContent).toContain("Hello");
    expect(ui.derivedLen().textContent).toContain("5");

    // 編輯草稿（只改 input）
    await fireEvent.update(ui.input(), "Hi");
    expect(ui.input().value).toBe("Hi");
    expect(ui.committed().textContent).toContain("Hello");
    expect(ui.derivedLen().textContent).toContain("5");

    // 送出：pending 期間「不 flush」，仍應顯示舊值
    await fireEvent.click(ui.saveBtn());
    expect(ui.saveBtn()).toHaveTextContent(/saving/i);
    expect(ui.committed().textContent).toContain("Hello"); // ← 修正：pending 仍舊
    expect(ui.derivedLen().textContent).toContain("5");    // ← 修正：pending 仍舊

    // 模擬 299ms：仍 pending、不變
    vi.advanceTimersByTime(299);
    await flushMicrotasks();
    await nextTick();
    expect(ui.saveBtn()).toHaveTextContent(/saving/i); // 仍 pending
    expect(ui.committed().textContent).toContain("Hello");
    expect(ui.derivedLen().textContent).toContain("5");

    // 再推 1ms 使請求完成：此時 atomic 才 flush → 一次性更新
    await vi.advanceTimersByTimeAsync(1);  // 讓 300ms 計時器真正結束
    await flushMicrotasks(); // 等 promise 鏈結束（atomic -> finally setSaving(false)）
    await nextTick(); // 等 Vue 把 DOM 更新完成
    expect(ui.saveBtn()).toHaveTextContent(/save/i);
    expect(ui.committed().textContent).toContain("Hi");
    expect(ui.derivedLen().textContent).toContain("2");
    expect(ui.error()).toBeNull();
  });

  it("failed save (回滾 + error)", async () => {
    const { default: Editor } = await import("../src/example/VueEditor.vue");
    const { container } = render(Editor);
    const ui = queriesOf(container as unknown as HTMLElement);

    // 勾「失敗」
    await fireEvent.click(ui.failToggle());
    expect(ui.failToggle().checked).toBe(true);

    // 改草稿
    await fireEvent.update(ui.input(), "Oops");
    expect(ui.input().value).toBe("Oops");
    expect(ui.committed().textContent).toContain("Hello");
    expect(ui.derivedLen().textContent).toContain("5");

    // 送出：pending 期間仍顯示舊值
    await fireEvent.click(ui.saveBtn());
    expect(ui.saveBtn()).toHaveTextContent(/saving/i);
    expect(ui.committed().textContent).toContain("Hello"); // pending 不變
    expect(ui.derivedLen().textContent).toContain("5");    // pending 不變

    // --- 失敗案例：完成後回滾 + 顯示錯誤 ---
    vi.advanceTimersByTime(299);
    await flushMicrotasks();
    await nextTick();
    expect(ui.saveBtn()).toHaveTextContent(/saving/i); // 仍 pending

    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks();
    await nextTick();

    expect(ui.saveBtn()).toHaveTextContent(/save/i);
    expect(ui.committed().textContent).toContain("Hello");
    expect(ui.derivedLen().textContent).toContain("5");
    const err = ui.error();
    expect(err).not.toBeNull();
    expect(err!.textContent).toMatch(/server says no/i);
  });
});
