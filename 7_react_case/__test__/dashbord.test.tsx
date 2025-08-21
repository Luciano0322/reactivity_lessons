// dashboard.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { StrictMode } from "react";
import { render, screen, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// 你的 reactive scheduler 會用 queueMicrotask，這裡準備一個通用 flush
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  if (typeof vi.runAllTicks === "function") vi.runAllTicks();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetModules(); // 讓 heartbeat 的 module-level effect 每次測試重新建立
});

describe("Dashboard", () => {
  it("renders initial values", async () => {
    const { Dashboard } = await import("../src/example/App.js");

    render(
      <StrictMode>
        <Dashboard />
      </StrictMode>
    );

    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading).toHaveTextContent(/Last heartbeat:\s*—/);

    expect(screen.getByText(/Polling every/i)).toHaveTextContent(
      "Polling every 1000 ms"
    );

    // 有出現 Blinker 的符號（不檢查其閃爍行為，避免干擾）
    expect(screen.getByText("|")).toBeInTheDocument();
  });

  it("updates last heartbeat when the signal changes", async () => {
    const { Dashboard } = await import("../src/example/App.js");
    const hb = await import("../src/example/heartbeat.js"); // 取得同一份 heartbeat 實例

    render(
      <StrictMode>
        <Dashboard />
      </StrictMode>
    );

    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading).toHaveTextContent(/—/);

    // 直接寫入 heartbeat（等效於定時器 callback 內的 set）
    await act(async () => {
      hb.heartbeat.set(new Date()); // 觸發訂閱者 effect -> notify()
      await flushMicrotasks();
    });
    expect(heading).not.toHaveTextContent(/—/);

    const firstText = heading.textContent!;
    await act(async () => {
      // 前進一點時間再更新，確保字串會不同
      vi.advanceTimersByTime(1000);
      hb.heartbeat.set(new Date());
      await flushMicrotasks();
    });
    expect(heading.textContent).not.toBe(firstText);
  });

  it("reflects intervalMs changes in UI (and subsequent heartbeats still update)", async () => {
    const { Dashboard } = await import("../src/example/App.js");
    const hb = await import("../src/example/heartbeat.js");

    render(
      <StrictMode>
        <Dashboard />
      </StrictMode>
    );

    const p = screen.getByText(/Polling every/i);
    const h3 = screen.getByRole("heading", { level: 3 });

    // 改輪詢間隔（等效於讓 module-level effect 重建 interval）
    await act(async () => {
      hb.intervalMs.set(200);
      await flushMicrotasks();
    });
    expect(p).toHaveTextContent("Polling every 200 ms");

    // 之後心跳變化依然能反映到 UI
    const shown = h3.textContent!;
    await act(async () => {
      vi.advanceTimersByTime(200);
      hb.heartbeat.set(new Date());
      await flushMicrotasks();
    });
    expect(h3.textContent).not.toBe(shown);
  });
});
