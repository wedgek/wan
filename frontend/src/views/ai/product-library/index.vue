<template>
  <div class="page-container product-library-page">
    <div class="page-filter-box">
      <div class="page-filter-left filters-wrap">
        <el-input
          v-model="tableParams.keyword"
          placeholder="产品名称"
          class="filter-input-keyword"
          :suffix-icon="$icons.Search"
          clearable
          clear-icon="Close"
        />
        <el-date-picker
          v-model="tableParams.createTimeRange"
          class="filter-date-range"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          format="YYYY-MM-DD"
          clearable
          clear-icon="Close"
        />
        <el-button type="primary" @click="tableSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
      </div>
    </div>

    <div class="page-table-header">
      <el-button type="primary" :icon="$icons.Plus" @click="openCreate">新增</el-button>
    </div>

    <div class="page-table-box table-wrap">
      <el-table
        :data="tableData"
        v-loading="tableLoading"
        border
        height="100%"
        :header-cell-style="{ 'text-align': 'center' }"
      >
        <el-table-column prop="id" label="产品ID" width="88" fixed="left" align="center" />
        <el-table-column prop="name" label="产品名称" min-width="140" fixed="left" align="center" show-overflow-tooltip />
        <el-table-column label="产品图" min-width="280" align="center" class-name="col-product-images">
          <template #default="{ row }">
            <div v-if="rowImages(row).length" class="ref-col-inner">
              <div class="ref-grid">
                <div
                  v-for="(url, idx) in rowImages(row)"
                  :key="idx + url.slice(-20)"
                  class="ref-tile"
                >
                  <div class="ref-media-box ratio-9-16 thumb-zoom-hover">
                    <el-image
                      class="ref-thumb-img"
                      :src="url"
                      fit="cover"
                      :preview-src-list="rowImages(row)"
                      :initial-index="idx"
                      preview-teleported
                    />
                  </div>
                </div>
              </div>
            </div>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="120" align="center" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.remark?.trim() ? row.remark : "—" }}
          </template>
        </el-table-column>
        <el-table-column prop="createTime" label="创建时间" min-width="160" align="center" show-overflow-tooltip />
        <el-table-column prop="updateTime" label="更新时间" min-width="160" align="center" show-overflow-tooltip />
        <el-table-column label="操作" width="220" align="center" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link :icon="$icons.DocumentCopy" @click="openCopy(row)">复制</el-button>
            <el-button type="primary" link :icon="$icons.Edit" @click="openEdit(row)">编辑</el-button>
            <el-button type="danger" link :icon="$icons.Delete" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="page-pagination-box">
      <CzPagination
        :total="tableTotal"
        v-model:page-no="tableParams.pageNo"
        v-model:page-size="tableParams.pageSize"
        @change="getTableData"
      />
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="min(560px, 94vw)"
      destroy-on-close
      align-center
      @closed="onDialogClosed"
    >
      <el-form ref="formRef" :model="form" label-width="88px" @submit.prevent>
        <el-form-item
          label="名称"
          prop="name"
          :rules="[{ required: true, message: '请输入产品名称', trigger: 'blur' }]"
        >
          <el-input v-model="form.name" maxlength="120" show-word-limit placeholder="产品名称" />
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="form.remark" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="可选" />
        </el-form-item>
        <el-form-item label="产品图">
          <div class="form-images">
            <div class="form-img-grid">
              <div v-for="(url, idx) in form.images" :key="idx + url.slice(-12)" class="form-img-tile">
                <div class="form-img-zoom-shell thumb-zoom-hover">
                  <el-image
                    class="form-thumb"
                    :src="url"
                    fit="cover"
                    :preview-src-list="form.images"
                    :initial-index="idx"
                    preview-teleported
                  />
                </div>
                <button type="button" class="form-img-remove" title="删除" @click.stop="removeFormImage(idx)">
                  <el-icon :size="16"><component :is="$icons.Delete" /></el-icon>
                </button>
              </div>
              <el-upload
                v-if="form.images.length < 20"
                class="form-uploader-dash"
                :show-file-list="false"
                accept="image/*"
                multiple
                :disabled="uploadBusy"
                :http-request="onFormImageUpload"
              >
                <div class="form-upload-dash-trigger" :class="{ 'is-disabled': uploadBusy }">
                  <el-icon v-if="!uploadBusy" class="form-upload-plus" :size="22">
                    <component :is="$icons.Plus" />
                  </el-icon>
                  <span v-else class="form-upload-loading-text">上传中</span>
                </div>
              </el-upload>
            </div>
            <div class="form-img-hint muted">最多 20 张，单张建议不超过 5 MB</div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saveLoading" @click="submitForm">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup name="aiProductLibrary">
import { useTable } from "@/hooks/useTable"
import CzPagination from "@/components/cz-pagination/index.vue"
import request from "@/request"
import { uploadImage } from "@/request/oss"

const defaultTableParams = () => ({
  keyword: "",
  createTimeRange: null,
  pageNo: 1,
  pageSize: 20,
})

const { tableParams, tableData, tableTotal, tableLoading, getTableData, tableSearch, resetTable } = useTable(
  "/admin-api/product-library/page",
  defaultTableParams,
  {
    transformParams: (raw) => {
      const p = { ...raw }
      if (Array.isArray(p.createTimeRange) && p.createTimeRange.length === 2) {
        const a = p.createTimeRange[0] ? String(p.createTimeRange[0]).trim() : ""
        const b = p.createTimeRange[1] ? String(p.createTimeRange[1]).trim() : ""
        p.createTimeFrom = a ? `${a} 00:00:00` : ""
        p.createTimeTo = b ? `${b} 23:59:59` : ""
      }
      delete p.createTimeRange
      return p
    },
  },
)

onMounted(() => {
  getTableData()
})

function onReset() {
  resetTable()
}

function rowImages(row) {
  const arr = Array.isArray(row.images) ? row.images : []
  return arr.filter((u) => u && String(u).trim().startsWith("http")).map((u) => String(u).trim())
}

const dialogVisible = ref(false)
const editingId = ref(null)
const formRef = ref(null)
const form = reactive({
  name: "",
  remark: "",
  images: [],
})
const saveLoading = ref(false)
const uploadBusy = ref(false)
/**  true：从某行复制打开弹窗，保存时走 POST 新建 */
const isCopyMode = ref(false)

const dialogTitle = computed(() => {
  if (editingId.value) return "编辑产品"
  if (isCopyMode.value) return "复制产品"
  return "新增产品"
})

function copyDisplayName(name) {
  const b = String(name || "").trim() || "未命名"
  const suffix = " 副本"
  if (b.length + suffix.length <= 120) return b + suffix
  return b.slice(0, 120 - suffix.length) + suffix
}

function openCreate() {
  isCopyMode.value = false
  editingId.value = null
  form.name = ""
  form.remark = ""
  form.images = []
  dialogVisible.value = true
}

function openEdit(row) {
  isCopyMode.value = false
  editingId.value = row.id
  form.name = String(row.name || "").trim()
  form.remark = String(row.remark || "").trim()
  form.images = [...rowImages(row)]
  dialogVisible.value = true
}

function openCopy(row) {
  isCopyMode.value = true
  editingId.value = null
  form.name = copyDisplayName(row.name)
  form.remark = String(row.remark || "").trim()
  form.images = [...rowImages(row)]
  dialogVisible.value = true
}

function onDialogClosed() {
  editingId.value = null
  isCopyMode.value = false
  form.name = ""
  form.remark = ""
  form.images = []
}

function removeFormImage(idx) {
  form.images.splice(idx, 1)
}

async function onFormImageUpload({ file }) {
  const raw = file?.raw ?? file
  if (!(raw instanceof File || raw instanceof Blob)) return
  if (form.images.length >= 20) {
    ElMessage.warning("最多 20 张产品图")
    return
  }
  uploadBusy.value = true
  try {
    const { url } = await uploadImage(raw)
    if (url) form.images.push(url)
  } catch (e) {
    ElMessage.error(e?.message || "上传失败")
  } finally {
    uploadBusy.value = false
  }
}

async function submitForm() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  saveLoading.value = true
  try {
    const body = {
      name: String(form.name || "").trim(),
      remark: String(form.remark || "").trim(),
      images: form.images.filter((u) => u && String(u).trim().startsWith("http")),
    }
    const id = editingId.value
    const res = id
      ? await request({
          url: `/admin-api/product-library/${id}`,
          method: "PUT",
          data: body,
        })
      : await request({
          url: "/admin-api/product-library",
          method: "POST",
          data: body,
        })
    if (res.code === 0) {
      ElMessage.success(id ? "已保存" : isCopyMode.value ? "已复制" : "已新增")
      dialogVisible.value = false
      getTableData()
    } else {
      ElMessage.error(res.msg || "保存失败")
    }
  } finally {
    saveLoading.value = false
  }
}

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除「${row.name || row.id}」？`, "删除确认", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    })
  } catch {
    return
  }
  try {
    const res = await request({
      url: `/admin-api/product-library/${row.id}`,
      method: "DELETE",
    })
    if (res.code === 0) {
      ElMessage.success("已删除")
      getTableData()
    } else {
      ElMessage.error(res.msg || "删除失败")
    }
  } catch (e) {
    ElMessage.error(e?.message || "删除失败")
  }
}
</script>

<style lang="scss" scoped>
.product-library-page {
  --thumb-size: 72px;
  --ref-media-w: 56px;
  --img-zoom-duration: 0.12s;
}

.page-container {
  .page-pagination-box {
    margin-top: 15px;
  }
}
.product-library-page .filters-wrap {
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
/* 与成员列表、提示词等页一致：筛选区与下方内容留白 */
.product-library-page .page-filter-box {
  margin-bottom: 12px;
}
/* 工具栏与表格表头之间留白（全局 page-table-header 原与表格顶边相接） */
.product-library-page .page-table-header {
  border-bottom: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}
.product-library-page .page-table-box {
  margin-top: 12px;
}
.product-library-page .page-filter-left .filter-input-keyword.el-input {
  width: 220px;
}
.product-library-page .page-filter-left .filter-date-range.el-date-editor {
  width: 280px;
  flex: 0 0 280px;
}
.product-library-page :deep(.el-table .col-product-images .cell) {
  display: flex;
  justify-content: center;
  align-items: center;
}
.ref-col-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
}
.ref-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, var(--ref-media-w));
  gap: 8px 10px;
  width: fit-content;
  max-width: 100%;
  margin-left: auto;
  margin-right: auto;
  justify-content: center;
}
.ref-tile {
  width: var(--ref-media-w);
  justify-self: center;
}
.ref-media-box {
  position: relative;
  border-radius: 6px;
  overflow: hidden;
  background: var(--el-fill-color-dark);
}
.ratio-9-16 {
  width: var(--ref-media-w);
  aspect-ratio: 9 / 16;
  height: auto;
}
.ref-thumb-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.ref-thumb-img :deep(.el-image__wrapper) {
  width: 100%;
  height: 100%;
}
.ref-thumb-img :deep(.el-image__inner) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--img-zoom-duration) ease-out;
  transform: scale(1);
}
.thumb-zoom-hover:hover :deep(.el-image__inner) {
  transform: scale(1.12);
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.form-images {
  width: 100%;
}
.form-img-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-start;
}
.form-img-tile {
  position: relative;
  width: var(--thumb-size);
  height: var(--thumb-size);
  border-radius: 6px;
  overflow: hidden;
  background: var(--el-fill-color-dark);
}
.form-img-zoom-shell {
  width: var(--thumb-size);
  height: var(--thumb-size);
  overflow: hidden;
  border-radius: 6px;
}
.form-thumb {
  width: var(--thumb-size);
  height: var(--thumb-size);
  display: block;
}
.form-thumb :deep(.el-image__inner) {
  width: var(--thumb-size);
  height: var(--thumb-size);
  object-fit: cover;
  transition: transform var(--img-zoom-duration) ease-out;
  transform: scale(1);
}
.form-img-tile .thumb-zoom-hover:hover :deep(.el-image__inner) {
  transform: scale(1.14);
}
.form-img-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--el-text-color-secondary);
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06);
  opacity: 0;
  transition:
    opacity 0.15s ease,
    color 0.15s ease,
    background 0.15s ease;
}
.form-img-tile:hover .form-img-remove {
  opacity: 1;
}
.form-img-remove:hover {
  color: var(--el-text-color-regular);
  background: #fff;
}
.form-uploader-dash :deep(.el-upload) {
  display: inline-flex;
  border: none;
  background: transparent;
  padding: 0;
}
.form-upload-dash-trigger {
  width: var(--thumb-size);
  height: var(--thumb-size);
  box-sizing: border-box;
  border: 1px dashed var(--el-border-color);
  border-radius: 6px;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: var(--el-fill-color-blank);
  transition:
    border-color 0.2s ease,
    background 0.2s ease;
}
.form-upload-dash-trigger:hover:not(.is-disabled) {
  border-color: var(--el-color-primary);
  background: var(--el-fill-color-light);
}
.form-upload-dash-trigger.is-disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
.form-upload-plus {
  color: var(--el-text-color-secondary);
}
.form-upload-dash-trigger:hover:not(.is-disabled) .form-upload-plus {
  color: var(--el-color-primary);
}
.form-upload-loading-text {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.form-img-hint {
  margin-top: 8px;
  line-height: 1.5;
}
</style>
