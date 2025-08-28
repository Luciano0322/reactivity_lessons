<script setup lang="ts">
import { ref, watch } from "vue";
import { signal } from "../core/signal.js";
import { atomic } from "../core/scheduler.js";
import { useSignalRef, useComputedRef } from "../hook/vue_adapter.js";

// ---- 模擬 API ----
async function postTitle(v: string, shouldFail = false) {
  await new Promise((r) => setTimeout(r, 300));
  if (shouldFail) throw new Error("server says no");
  return true;
}

// ---- 狀態 ----
const titleSig = signal("Hello");
const committed = useSignalRef(titleSig);
const titleLen = useComputedRef(() => titleSig.get().length);

const draft = ref(committed.value);
watch(committed, (v) => (draft.value = v)); // 外部變更時同步草稿

const saving = ref(false);
const error = ref<string | null>(null);
const shouldFail = ref(false);

async function save() {
  saving.value = true;
  error.value = null;
  try {
    await atomic(async () => {
      // 樂觀寫入，不會馬上 flush
      titleSig.set(draft.value);
      await postTitle(draft.value, shouldFail.value); // 可能 throw
    });
    // 成功：退出 atomic 才 flush → 模板一次更新
  } catch (e: any) {
    // 失敗：回滾、不 flush → 模板維持舊值
    error.value = e?.message ?? "save failed";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section>
    <div>
      <label>
        Draft:
        <input v-model="draft" :disabled="saving" />
      </label>
      <button @click="save" :disabled="saving">
        {{ saving ? "Saving..." : "Save" }}
      </button>
      <label style="margin-left: 8px">
        <input type="checkbox" v-model="shouldFail" :disabled="saving" />
        simulate failure
      </label>
    </div>

    <hr />

    <p>
      Committed title: <b>{{ committed }}</b>
    </p>
    <p>
      Derived length (computed): <b>{{ titleLen }}</b>
    </p>
    <p v-if="error" style="color: crimson">Error: {{ error }}</p>
  </section>
</template>
