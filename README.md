# reactivity_lessons

## 2025 IThome articles

- 專案內的 Lesson 代號會對應 signal 實作開始的環節
- 每個 Lesson 代號會對應上一章節的 code 往下延伸，方便讀者閱讀
- 核心的部分與鐵人賽文章內的設定是相同的，這系列以教學為主，所以要轉為 production 使用的話，要考慮資料結構與記憶體釋放的問題

### Two-phase flush flow chart

```mermaid
flowchart TD
  A["開始 flushJobsTwoPhase()"] --> B{computeQ 與 effectQ 都為空?}
  B -- 是 --> Z[結束 return]
  B -- 否 --> C[scheduled = false]

  C --> D{computeQ 為空?}
  D -- 否 --> E[取出一批 computeQ]
  E --> F["逐個 job.run()<br/>可能 enqueue 新的 computed/effect"]
  F --> D
  D -- 是 --> G[進入 Phase B]

  G --> H{effectQ 為空?}
  H -- 否 --> I["按 priority(小→大) 排序 effectQ"]
  I --> J["逐個 effect.run()<br/>可能 enqueue 新的 computed/effect"]
  J --> K{"有新工作?（computeQ 或 effectQ）"}
  K -- 是 --> C
  K -- 否 --> Z

  H -- 是 --> Z

```

### Topological flow chart

```mermaid
flowchart TD

A["開始 flushJobsTopo()"] --> B{allJobs 為空?}
B -- 是 --> Z[直接 return]
B -- 否 --> C[初始化 indegree = 0]
C --> D[掃描每個 job.dependsOn<br/>對應的上游 job<br/>計算 indegree+1]
D --> E[建立 ready 集合<br/>挑 indegree = 0 的 job<br/>放進 min-heap]

E --> F{heap 為空?}
F -- 是且 allJobs 空 --> Z
F -- 是但 allJobs 還有 --> Y[可能有循環 → fallback 執行所有 job]
F -- 否 --> G[從 heap pop 出<br/>priority 最小的 job]
G --> H["執行 job.run()"]
H --> I[從 allJobs 移除 job]
I --> J[對所有依賴這個 job 的下游 indegree -1<br/>若變成 0 → push heap]
J --> F

```
