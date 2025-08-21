import { useSignalValue } from "../hook/react_adapter.js";
import { Blinker } from "./Blinker.js";
import { heartbeat, intervalMs } from "./heartbeat.js";

export function Dashboard() {
  const lastBeat = useSignalValue(heartbeat);
  const ms = useSignalValue(intervalMs);

  return (
    <section>
      <h3>Last heartbeat: {lastBeat?.toLocaleTimeString() ?? "—"}</h3>
      <p>Polling every {ms} ms</p>
      <Blinker enabled /> {/* UI 計時由 React 管 */}
    </section>
  );
}
