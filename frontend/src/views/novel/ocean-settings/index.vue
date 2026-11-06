<template>
  <div class="page-container novel-page ocean-settings">
    <div class="section">
      <div class="section-head">
        <span>授权</span>
        <el-tag :type="authorized ? 'success' : 'info'" size="small">{{ authorized ? "已授权" : "未授权" }}</el-tag>
        <el-button v-if="authorized" class="head-action" size="small" :loading="copyLoading" @click="copyAuth">复制授权</el-button>
      </div>
      <p class="hint">
        <template v-if="allowImport">在线上授权页点「复制授权」，把内容贴到下面。本地只拿来调用，续期仍由线上负责。线上自动续期后，再复制一次即可。</template>
        <template v-else-if="authorized">下面是这次授权的对象和有效期。到期前会自动续期。点「复制授权」可以拿到本地用。</template>
        <template v-else>点一次「去授权」，用巨量工作台组织账号同意。同意后会回到本页。</template>
      </p>
      <dl v-if="app" class="facts">
        <div>
          <dt>应用</dt>
          <dd>{{ app.name || "—" }}</dd>
        </div>
        <div>
          <dt>AppID</dt>
          <dd>{{ app.appId || "—" }}</dd>
        </div>
        <div>
          <dt>组织 ID</dt>
          <dd>{{ app.accountId || "—" }}</dd>
        </div>
        <div>
          <dt>授权账户</dt>
          <dd>{{ advertiserText }}</dd>
        </div>
        <div>
          <dt>Access Token</dt>
          <dd>{{ authorized ? `有效至 ${fmtTime(app.accessExpiresAt)}` : "未授权" }}</dd>
        </div>
        <div>
          <dt>Refresh Token</dt>
          <dd>{{ refreshText }}</dd>
        </div>
      </dl>
      <p v-if="message && !authorized" class="hint warn">{{ message }}</p>
      <p v-else-if="app && app.lastError" class="hint warn">{{ app.lastError }}</p>
      <el-button v-if="!authorized && !allowImport" type="primary" :loading="authLoading" @click="goAuth">去授权</el-button>
      <div v-if="allowImport" class="import-box">
        <el-input v-model="importText" type="textarea" :rows="4" placeholder="粘贴线上复制的授权" />
        <el-button type="primary" class="import-btn" :loading="importLoading" @click="importAuth">导入到本地</el-button>
      </div>
    </div>
  </div>
</template>

<script setup name="novelOceanSettings">
import { useRoute, useRouter } from "vue-router"
import request from "@/request"

const route = useRoute()
const router = useRouter()
const authLoading = ref(false)
const copyLoading = ref(false)
const importLoading = ref(false)
const authorized = ref(false)
const allowImport = ref(false)
const importText = ref("")
const message = ref("")
const appPk = ref(null)
const app = ref(null)

onMounted(async () => {
  const flag = String(route.query.ocean || "")
  if (flag === "ok") ElMessage.success("授权成功，之后会自动续期")
  if (flag === "fail") ElMessage.error(String(route.query.msg || "授权失败"))
  if (flag) {
    const next = { ...route.query }
    delete next.ocean
    delete next.msg
    router.replace({ path: route.path, query: next })
  }
  await load()
})

async function load() {
  try {
    const res = await request({
      url: "/admin-api/oceanengine/settings",
      timeout: 30000,
      params: { scope: "auth" },
    })
    if (res.code !== 0) {
      message.value = res.msg || "读取授权状态失败"
      return
    }
    const data = res.data || {}
    authorized.value = !!data.authorized
    allowImport.value = !!data.allowImport
    message.value = data.authorized ? "" : data.message || ""
    appPk.value = data.appPk || null
    app.value = (data.apps || []).find((item) => item.id === data.appPk) || (data.apps || [])[0] || null
  } catch {
    message.value = "读取授权状态失败"
  }
}

async function writeClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }
  const el = document.createElement("textarea")
  el.value = text
  el.setAttribute("readonly", "readonly")
  el.style.position = "fixed"
  el.style.left = "-9999px"
  document.body.appendChild(el)
  el.select()
  document.execCommand("copy")
  document.body.removeChild(el)
}

async function copyAuth() {
  copyLoading.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/auth/export",
      method: "POST",
      data: { appPk: appPk.value },
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "复制失败")
      return
    }
    const text = (res.data && res.data.text) || ""
    if (!text) {
      ElMessage.error("没有可复制的授权")
      return
    }
    await writeClipboard(text)
    ElMessage.success("已复制，到本地授权页粘贴导入")
  } finally {
    copyLoading.value = false
  }
}

async function importAuth() {
  const text = importText.value.trim()
  if (!text) {
    ElMessage.error("请先粘贴授权内容")
    return
  }
  importLoading.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/auth/import",
      method: "POST",
      data: { text },
      timeout: 30000,
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "导入失败")
      return
    }
    importText.value = ""
    ElMessage.success("已导入到本地")
    await load()
  } finally {
    importLoading.value = false
  }
}

const advertiserText = computed(() => {
  const ids = app.value && app.value.advertiserIds
  if (!ids || !ids.length) return authorized.value ? "已授权，接口未返回具体账户" : "—"
  return ids.join("、")
})

const refreshText = computed(() => {
  if (!authorized.value) return "未授权"
  const until = `有效至 ${fmtTime(app.value && app.value.refreshExpiresAt)}`
  return allowImport.value ? `${until}，续期由线上负责` : `${until}，到期前自动刷新`
})

function fmtTime(value) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).replace("T", " ").slice(0, 16)
  const p = (n) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`
}

async function goAuth() {
  if (!appPk.value) {
    ElMessage.error("还没有可用的巨量应用")
    return
  }
  authLoading.value = true
  try {
    const res = await request({ url: `/admin-api/oceanengine/apps/${appPk.value}/authorize`, method: "POST" })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "生成授权链接失败")
      return
    }
    window.location.href = res.data.url
  } finally {
    authLoading.value = false
  }
}
</script>

<style scoped lang="scss">
@use "../novel-page.scss";

.ocean-settings {
  min-height: 0;
}

.section {
  padding: 16px;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-weight: 600;
}

.head-action {
  margin-left: auto;
}

.import-box {
  margin-top: 4px;
}

.import-btn {
  margin-top: 12px;
}

.hint {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.hint.warn {
  color: var(--el-color-warning);
}

.facts {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 10px 12px;
  margin: 0 0 16px;

  div {
    display: contents;
  }

  dt {
    color: var(--el-text-color-secondary);
  }

  dd {
    margin: 0;
  }
}
</style>
