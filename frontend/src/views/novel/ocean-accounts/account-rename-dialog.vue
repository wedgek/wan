<template>
  <el-dialog
    :model-value="modelValue"
    title="批量修改账户名称"
    width="760px"
    destroy-on-close
    append-to-body
    class="account-rename-dialog"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <p class="hint">
      已选 {{ accounts.length }} 个账户。账户名称不少于 2 个字符且不超过 20 个中文字符或 40 个数字，一个中文字符等于两个数字，结尾标号不建议相同。
    </p>
    <el-form label-width="88px" class="rule-form">
      <el-form-item label="名称规则">
        <el-input v-model="form.rule" placeholder="例如：{原账户名称}{动态标号} 或 {所属人}-{动态标号}" clearable />
      </el-form-item>
      <div class="token-row">
        <el-button size="small" @click="insertToken('{原账户名称}')">原账户名称</el-button>
        <el-button size="small" @click="insertToken('{原账户名称}{动态标号}')">账户名称+标号</el-button>
        <el-button size="small" @click="insertToken('{所属人}')">所属人</el-button>
      </div>
      <div class="extra-row">
        <div class="extra-item">
          <span>动态标号起始</span>
          <el-input-number v-model="form.startNo" :min="1" :max="99999" :step="1" controls-position="right" />
        </div>
        <div class="extra-item extra-owner">
          <span>所属人</span>
          <el-input v-model="form.owner" placeholder="替换 {所属人}" clearable />
        </div>
        <el-button type="primary" @click="applied = true">应用</el-button>
      </div>
    </el-form>

    <el-table :data="previewRows" border size="small" max-height="360" class="preview-table">
      <el-table-column prop="advertiserId" label="账户ID" width="180" align="center" />
      <el-table-column prop="oldName" label="原账户名称" min-width="160" show-overflow-tooltip />
      <el-table-column label="新账户名称" min-width="180">
        <template #default="{ row }">
          <span :class="{ invalid: row.invalid }">{{ row.newName || "—" }}</span>
        </template>
      </el-table-column>
      <el-table-column label="字数" width="72" align="center">
        <template #default="{ row }">
          <span :class="{ invalid: row.invalid }">{{ row.weight }}</span>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canSubmit" @click="submit">确认修改</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import request from "@/request"

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  accounts: { type: Array, default: () => [] },
})

const emit = defineEmits(["update:modelValue", "done"])

const saving = ref(false)
const applied = ref(false)
const form = reactive({
  rule: "{原账户名称}",
  startNo: 1,
  owner: "",
})

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    applied.value = true
    form.rule = "{原账户名称}"
    form.startNo = 1
    form.owner = ""
  },
)

function nameWeight(value) {
  let n = 0
  for (const ch of String(value || "")) {
    n += /[\u4e00-\u9fff]/.test(ch) ? 2 : 1
  }
  return n
}

function insertToken(token) {
  form.rule = `${form.rule || ""}${token}`
}

function buildName(account, index) {
  const rule = String(form.rule || "")
  if (!rule) return ""
  return rule
    .replaceAll("{原账户名称}", account.name || "")
    .replaceAll("{动态标号}", String(Math.max(1, Number(form.startNo) || 1) + index))
    .replaceAll("{所属人}", String(form.owner || "").trim())
    .trim()
}

const previewRows = computed(() => {
  if (!applied.value) return []
  return props.accounts.map((account, index) => {
    const newName = buildName(account, index)
    const weight = nameWeight(newName)
    return {
      advertiserId: account.advertiserId,
      oldName: account.name || "",
      newName,
      weight,
      invalid: !newName || weight < 2 || weight > 40,
    }
  })
})

const canSubmit = computed(() => previewRows.value.length > 0 && previewRows.value.every((row) => !row.invalid))

function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

async function submit() {
  if (!canSubmit.value) return
  saving.value = true
  try {
    let success = 0
    let audit = 0
    let fail = 0
    const errors = []
    for (const part of chunk(previewRows.value, 30)) {
      const res = await request({
        url: "/admin-api/oceanengine/accounts/rename",
        method: "POST",
        timeout: 180000,
        data: {
          items: part.map((row) => ({ advertiserId: row.advertiserId, name: row.newName })),
        },
      })
      if (res.code !== 0) {
        ElMessage.error(res.msg || "批量改名失败")
        return
      }
      const data = res.data || {}
      success += Number(data.success) || 0
      audit += Number(data.audit) || 0
      fail += Number(data.fail) || 0
      for (const item of data.results || []) {
        if (!item.ok && item.error) errors.push(`${item.advertiserId}：${item.error}`)
      }
    }
    const parts = []
    if (success) parts.push(`成功 ${success} 个`)
    if (audit) parts.push(`待审核 ${audit} 个`)
    if (fail) parts.push(`失败 ${fail} 个`)
    if (fail) ElMessage.warning(parts.join("，") || "部分失败")
    else ElMessage.success(parts.join("，") || "已提交")
    if (errors.length && errors.length <= 5) {
      ElMessage.warning(errors.join("；"))
    }
    emit("done")
    emit("update:modelValue", false)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped lang="scss">
.hint {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.rule-form {
  margin-bottom: 12px;
}

.token-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: -6px 0 12px 88px;
}

.extra-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin: 0 0 8px 88px;
}

.extra-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.extra-owner {
  flex: 1;
  min-width: 180px;

  .el-input {
    flex: 1;
  }
}

.preview-table {
  width: 100%;
}

.invalid {
  color: var(--el-color-danger);
}
</style>
