import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import {
  render,
  fireEvent,
  within,
  act,
  cleanup,
} from "@testing-library/react";
import { signal } from "../src/core/signal.js";
import { Editor } from "../src/example/ReactEditor.js";

const flushMicrotasks = async (n = 2) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

function queriesOf(container: HTMLElement) {
  const q = within(container.querySelector("section")!);
  return {
    input: () => q.getByRole("textbox") as HTMLInputElement,
    saveBtn: () => q.getByRole("button", { name: /save|saving/i }),
    failToggle: () => q.getByRole("checkbox") as HTMLInputElement,
    committed: () => q.getByText(/Committed title:/),
    derivedLen: () => q.getByText(/Derived length/),
    error: () => q.queryByText(/Error:/),
  };
}

describe("Editor (atomic optimistic save) — optimistic visible immediately", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("successful save: 點擊後樂觀值立刻可見，pending 期間不變；完成後維持新值", async () => {
    const { container } = render(<Editor __sig={signal("Hello")} />);
    const ui = queriesOf(container);

    // 初值
    expect(ui.input().value).toBe("Hello");
    expect(ui.committed().textContent).toContain("Hello");
    expect(ui.derivedLen().textContent).toContain("5");

    // 改草稿（僅本地）
    await act(async () => {
      fireEvent.input(ui.input(), { target: { value: "Hi" } });
      await flushMicrotasks();
    });
    expect(ui.input().value).toBe("Hi");
    expect(ui.committed().textContent).toContain("Hello");
    expect(ui.derivedLen().textContent).toContain("5");

    // 送出 → 樂觀值立刻進畫面
    fireEvent.click(ui.saveBtn());
    expect(ui.saveBtn()).toHaveTextContent(/saving/i);
    expect(ui.committed().textContent).toContain("Hi");
    expect(ui.derivedLen().textContent).toContain("5");

    // pending：不變
    act(() => vi.advanceTimersByTime(299));
    expect(ui.committed().textContent).toContain("Hi");
    expect(ui.derivedLen().textContent).toContain("5");

    // 完成
    await act(async () => {
      vi.advanceTimersByTime(1);
      await flushMicrotasks();
    });
    expect(ui.saveBtn()).toHaveTextContent(/save/i);
    expect(ui.committed().textContent).toContain("Hi");
    expect(ui.derivedLen().textContent).toContain("5");
    expect(ui.error()).toBeNull();
  });

  it("failed save: 點擊後樂觀值立刻可見，pending 期間不變；完成時回滾並顯示錯誤", async () => {
    const { container } = render(<Editor __sig={signal("Hello")} />);
    const ui = queriesOf(container);

    // 勾選失敗
    fireEvent.click(ui.failToggle());
    expect(ui.failToggle().checked).toBe(true);

    // 改草稿
    await act(async () => {
      fireEvent.input(ui.input(), { target: { value: "Oops" } });
      await flushMicrotasks();
    });
    expect(ui.input().value).toBe("Oops");
    expect(ui.committed().textContent).toContain("Hello");
    expect(ui.derivedLen().textContent).toContain("5");

    // 送出 → 立刻顯示樂觀值
    fireEvent.click(ui.saveBtn());
    expect(ui.saveBtn()).toHaveTextContent(/saving/i);
    expect(ui.committed().textContent).toContain("Oops");
    expect(ui.derivedLen().textContent).toContain("5");

    // pending：不變
    act(() => vi.advanceTimersByTime(299));
    expect(ui.committed().textContent).toContain("Oops");
    expect(ui.derivedLen().textContent).toContain("5");

    // 完成：回滾 + 錯誤
    await act(async () => {
      vi.advanceTimersByTime(1);
      await flushMicrotasks();
    });
    expect(ui.saveBtn()).toHaveTextContent(/save/i);
    expect(ui.committed().textContent).toContain("Hello");
    expect(ui.derivedLen().textContent).toContain("5");
    expect(ui.error()).not.toBeNull();
    expect(ui.error()!.textContent).toMatch(/server says no/i);
  });

  it("no flicker: 點擊後顯示樂觀值，等待期間不再跳動，最後定格（成功）", async () => {
    const { container } = render(<Editor __sig={signal("Hello")} />);
    const ui = queriesOf(container);

    await act(async () => {
      fireEvent.input(ui.input(), { target: { value: "World" } });
      await flushMicrotasks();
    });
    expect(ui.input().value).toBe("World");
    expect(ui.committed().textContent).toContain("Hello");
    expect(ui.derivedLen().textContent).toContain("5");

    fireEvent.click(ui.saveBtn());
    expect(ui.saveBtn()).toHaveTextContent(/saving/i);
    expect(ui.committed().textContent).toContain("World");
    expect(ui.derivedLen().textContent).toContain("5");

    act(() => vi.advanceTimersByTime(150));
    expect(ui.committed().textContent).toContain("World");
    expect(ui.derivedLen().textContent).toContain("5");

    await act(async () => {
      vi.advanceTimersByTime(150);
      await flushMicrotasks();
    });
    expect(ui.saveBtn()).toHaveTextContent(/save/i);
    expect(ui.committed().textContent).toContain("World");
    expect(ui.derivedLen().textContent).toContain("5");
  });
});
