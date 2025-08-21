import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { Blinker } from "../src/example/Blinker.js"; // ← 改成你的相對路徑

beforeEach(() => {
  // 用假時鐘精準控制 setInterval
  vi.useFakeTimers();
  // 固定系統時間，讓不同環境更穩定（非必要，但建議）
  vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function getCaret() {
  return screen.getByText("|"); // <span> 的內容是 |
}

describe("Blinker", () => {
  it("blinks every 500ms when enabled (default)", () => {
    render(<Blinker />);

    // 初始 off
    expect(getCaret()).toHaveClass("caret");
    expect(getCaret()).not.toHaveClass("on");

    // 500ms → on
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(getCaret()).toHaveClass("caret", "on");

    // 1000ms 總計（再 500ms）→ off
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(getCaret()).toHaveClass("caret");
    expect(getCaret()).not.toHaveClass("on");

    // 再 500ms → on
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(getCaret()).toHaveClass("caret", "on");
  });

  it("does nothing when disabled", () => {
    render(<Blinker enabled={false} />);

    // 一直維持 off
    expect(getCaret()).toHaveClass("caret");
    expect(getCaret()).not.toHaveClass("on");

    // 即使時間推進也不會變
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(getCaret()).toHaveClass("caret");
    expect(getCaret()).not.toHaveClass("on");
  });

  it("starts when enabled turns true, and stops when it turns false again", () => {
    const { rerender } = render(<Blinker enabled={false} />);

    // 初始 disabled → 不會變
    expect(getCaret()).toHaveClass("caret");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(getCaret()).not.toHaveClass("on");

    // 切到 enabled:true → 開始每 500ms 交替
    rerender(<Blinker enabled />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(getCaret()).toHaveClass("caret", "on");

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(getCaret()).toHaveClass("caret");
    expect(getCaret()).not.toHaveClass("on");

    // 再切回 enabled:false → 停止在當前狀態
    rerender(<Blinker enabled={false} />);
    const classNow = getCaret().className;
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(getCaret().className).toBe(classNow); // 不再變動
  });
});
