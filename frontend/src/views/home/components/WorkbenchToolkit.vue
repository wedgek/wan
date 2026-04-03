<template>
  <section class="wb-tools" aria-label="实用工具">
    <div class="wb-tools__head">
      <h3 class="wb-tools__title">小工具</h3>
      <p class="wb-tools__sub">常用辅助，不占业务菜单</p>
    </div>
    <div class="wb-tools__grid">
      <button v-for="t in tools" :key="t.key" type="button" class="wb-tools__cell" @click="openTool(t.key)">
        <el-icon class="wb-tools__ico"><component :is="t.icon" /></el-icon>
        <span class="wb-tools__name">{{ t.name }}</span>
        <span class="wb-tools__hint">{{ t.hint }}</span>
      </button>
    </div>

    <el-drawer v-model="drawerVisible" :title="drawerTitle" direction="rtl" size="min(420px, 92vw)">
      <div v-if="activeTool === 'ts'" class="wb-drawer">
        <p class="wb-drawer__tip">支持秒 / 毫秒时间戳与 ISO 字符串互转（本地计算，不上传）。</p>
        <el-input v-model="tsInput" type="text" placeholder="1735689600 或 2026-01-01T00:00:00.000Z" clearable />
        <div class="wb-drawer__row">
          <el-button type="primary" @click="convertTs">转换</el-button>
          <el-button @click="fillNow">当前时间</el-button>
        </div>
        <pre v-if="tsResult" class="wb-drawer__pre">{{ tsResult }}</pre>
      </div>

      <div v-else-if="activeTool === 'json'" class="wb-drawer">
        <p class="wb-drawer__tip">粘贴 JSON，尝试格式化（解析失败会提示）。</p>
        <el-input v-model="jsonInput" type="textarea" :rows="10" placeholder='{"a":1}' />
        <div class="wb-drawer__row">
          <el-button type="primary" @click="formatJson">格式化</el-button>
          <el-button @click="jsonInput = ''; jsonError = ''">清空</el-button>
        </div>
        <el-alert v-if="jsonError" type="error" :closable="false" :title="jsonError" class="wb-drawer__alert" />
        <pre v-else-if="jsonOutput" class="wb-drawer__pre">{{ jsonOutput }}</pre>
      </div>

      <div v-else-if="activeTool === 'search'" class="wb-drawer">
        <p class="wb-drawer__tip">在顶栏使用全局搜索，可快速跳转到任意有权限的菜单页。</p>
        <ul class="wb-drawer__list">
          <li><kbd class="wb-kbd">Ctrl</kbd> + <kbd class="wb-kbd">K</kbd>（Windows / Linux）</li>
          <li><kbd class="wb-kbd">⌘</kbd> + <kbd class="wb-kbd">K</kbd>（macOS）</li>
        </ul>
        <el-button type="primary" @click="closeAndHint">我知道了</el-button>
      </div>
    </el-drawer>
  </section>
</template>

<script setup>
import { Clock, DocumentCopy, Search } from "@element-plus/icons-vue"
import { ElMessage } from "element-plus"

const drawerVisible = ref(false)
const activeTool = ref("")

const tools = [
  { key: "ts", name: "时间戳", hint: "秒/毫秒", icon: Clock },
  { key: "json", name: "JSON", hint: "格式化", icon: DocumentCopy },
  { key: "search", name: "全局搜", hint: "快捷键", icon: Search },
]

const drawerTitle = computed(() => {
  const m = { ts: "时间戳转换", json: "JSON 格式化", search: "全局菜单搜索" }
  return m[activeTool.value] || "工具"
})

const tsInput = ref("")
const tsResult = ref("")

const jsonInput = ref("")
const jsonOutput = ref("")
const jsonError = ref("")

const openTool = (key) => {
  activeTool.value = key
  tsResult.value = ""
  jsonOutput.value = ""
  jsonError.value = ""
  drawerVisible.value = true
}

const fillNow = () => {
  tsInput.value = String(Math.floor(Date.now() / 1000))
}

const convertTs = () => {
  const raw = tsInput.value.trim()
  tsResult.value = ""
  if (!raw) return
  const n = Number(raw)
  if (Number.isFinite(n) && String(raw).length >= 12) {
    const d = new Date(n)
    if (!Number.isNaN(d.getTime())) {
      tsResult.value = `毫秒戳 →\n${d.toISOString()}\n本地化：${d.toLocaleString()}`
      return
    }
  }
  if (Number.isFinite(n) && n > 1e9 && n < 1e13) {
    const sec = raw.length >= 13 ? Math.floor(n / 1000) : n
    const d = new Date(sec * 1000)
    if (!Number.isNaN(d.getTime())) {
      tsResult.value = `秒戳 →\n${d.toISOString()}\n本地化：${d.toLocaleString()}`
      return
    }
  }
  const d = new Date(raw)
  if (!Number.isNaN(d.getTime())) {
    const s = Math.floor(d.getTime() / 1000)
    const ms = d.getTime()
    tsResult.value = `日期 →\n秒：${s}\n毫秒：${ms}`
    return
  }
  tsResult.value = "无法识别，请输入秒/毫秒数字或可解析的日期字符串。"
}

const formatJson = () => {
  jsonOutput.value = ""
  jsonError.value = ""
  const s = jsonInput.value.trim()
  if (!s) return
  try {
    const o = JSON.parse(s)
    jsonOutput.value = JSON.stringify(o, null, 2)
  } catch (e) {
    jsonError.value = e?.message || "JSON 解析失败"
  }
}

const closeAndHint = () => {
  drawerVisible.value = false
  ElMessage.success("在顶栏搜索框也可打开菜单搜索")
}
</script>

<style scoped lang="scss">
.wb-tools {
  padding: 22px 24px;
  border-radius: var(--wb-radius, 20px);
  background: var(--wb-card-bg, var(--el-bg-color-overlay));
  border: 1px solid var(--wb-card-border, var(--app-border));
  box-shadow: var(--wb-card-shadow, none);
}

.wb-tools__head {
  margin-bottom: 16px;
}

.wb-tools__title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--app-text);
}

.wb-tools__sub {
  margin: 0;
  font-size: 12px;
  color: var(--app-muted);
}

.wb-tools__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

@media (max-width: 520px) {
  .wb-tools__grid {
    grid-template-columns: 1fr;
  }
}

.wb-tools__cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid var(--app-border);
  background: var(--el-fill-color-lighter);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.2s, transform 0.2s;

  &:hover {
    border-color: var(--el-color-primary-light-5);
    transform: translateY(-2px);
  }
}

html.dark .wb-tools__cell {
  background: rgba(255, 255, 255, 0.05);
}

.wb-tools__ico {
  font-size: 22px;
  color: var(--el-color-primary);
}

.wb-tools__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text);
}

.wb-tools__hint {
  font-size: 11px;
  color: var(--app-muted);
}

.wb-drawer__tip {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--app-muted);
  line-height: 1.5;
}

.wb-drawer__row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
}

.wb-drawer__pre {
  margin: 14px 0 0;
  padding: 12px;
  border-radius: 10px;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--app-border);
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 240px;
  overflow: auto;
}

.wb-drawer__alert {
  margin-top: 12px;
}

.wb-drawer__list {
  margin: 0 0 16px;
  padding-left: 18px;
  font-size: 14px;
  color: var(--app-text);
  line-height: 1.8;
}

.wb-kbd {
  display: inline-block;
  padding: 2px 8px;
  margin: 0 2px;
  font-size: 12px;
  font-family: inherit;
  border-radius: 6px;
  border: 1px solid var(--app-border);
  background: var(--el-fill-color-light);
}
</style>
