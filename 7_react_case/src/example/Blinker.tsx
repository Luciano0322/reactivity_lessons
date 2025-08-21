import { useState, useEffect } from "react";

export function Blinker({ enabled = true }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setOn((v) => !v), 500);
    return () => clearInterval(id); // 下一次 commit 前清理
  }, [enabled]);

  return <span className={on ? "caret on" : "caret"}>|</span>;
}
