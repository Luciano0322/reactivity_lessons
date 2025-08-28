import { useState, useEffect } from "react";
import { signal } from "../core/signal.js";
import { atomic } from "../core/scheduler.js";
import {
  useSignalValue,
  useSignalState,
  useComputed,
} from "../hook/react_adapter.js";

// ---- 模擬 API ----
async function postTitle(v: string, shouldFail = false) {
  await new Promise((r) => setTimeout(r, 300)); // 模擬延遲
  if (shouldFail) throw new Error("server says no");
  return true;
}

// ---- 狀態 ----
const titleSig = signal("Hello");

export type EditorTestProps = { __sig?: ReturnType<typeof signal<string>> };

export function Editor({ __sig }: EditorTestProps = {}) {
  const sig = __sig ?? titleSig; // ← 預設用 module-scope 的；測試可覆蓋

  const committed = useSignalValue(sig); // 讀外部 signal 的快照
  const [draft, setDraft] = useSignalState(committed); // 本地草稿
  useEffect(() => setDraft(committed), [committed]);

  const len = useComputed(() => titleSig.get().length); // ✅ hook 回傳「值」

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shouldFail, setShouldFail] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await atomic(async () => {
        sig.set(draft); // 樂觀寫入（不立刻 flush）
        await postTitle(draft, shouldFail); // 可能 throw → 回滾 + 不 flush
      });
      // 成功：退出 atomic 才 flush，一次更新 committed/len
    } catch (e: any) {
      setError(e?.message ?? "save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={saving}
      />
      <button onClick={save} disabled={saving}>
        {saving ? "Saving..." : "Save"}
      </button>
      <label style={{ marginLeft: 8 }}>
        <input
          type="checkbox"
          checked={shouldFail}
          onChange={(e) => setShouldFail(e.target.checked)}
        />
        simulate failure
      </label>

      <hr />
      <p>
        Committed title: <b>{committed}</b>
      </p>
      <p>
        Derived length (computed): <b>{len}</b>
      </p>
      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
    </section>
  );
}
