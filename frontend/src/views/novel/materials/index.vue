<template>
  <div class="page-container novel-page novel-materials">
    <div class="page-filter-box filter-bar">
      <div class="page-filter-left filters-wrap">
        <el-input
          v-model="tableParams.keyword"
          placeholder="素材名 / 链接 / 书名"
          class="filter-input-keyword"
          :suffix-icon="$icons.Search"
          clearable
          clear-icon="Close"
        />
        <BookSelect v-model="tableParams.bookId" class="filter-select-book" placeholder="所属书籍" />
        <el-select
          v-model="tableParams.convertStatus"
          placeholder="转化状态"
          class="filter-select-sm"
          clearable
          clear-icon="Close"
          :suffix-icon="$icons.ArrowDown"
        >
          <el-option v-for="s in CONVERT_STATUS_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />
        </el-select>
        <el-select
          v-model="tableParams.isHot"
          placeholder="是否爆款"
          class="filter-select-sm"
          clearable
          clear-icon="Close"
          :suffix-icon="$icons.ArrowDown"
        >
          <el-option label="爆款" value="1" />
          <el-option label="普通" value="0" />
        </el-select>
        <el-select
          v-model="tableParams.unassigned"
          placeholder="归属"
          class="filter-select-sm"
          clearable
          clear-icon="Close"
          :suffix-icon="$icons.ArrowDown"
        >
          <el-option label="未归属" value="1" />
        </el-select>
        <el-select
          v-model="tableParams.onlyNew"
          placeholder="新素材"
          class="filter-select-sm"
          clearable
          clear-icon="Close"
          :suffix-icon="$icons.ArrowDown"
        >
          <el-option label="仅看新素材" value="1" />
        </el-select>
        <el-button type="primary" @click="tableSearch">查询</el-button>
        <el-button @click="resetTable">重置</el-button>
      </div>
    </div>

    <div class="page-table-box table-wrap">
      <el-table
        :data="tableData"
        v-loading="tableLoading"
        border
        height="100%"
        :header-cell-style="{ 'text-align': 'center' }"
      >
        <el-table-column label="封面" width="80" align="center" fixed="left">
          <template #default="{ row }">
            <el-image
              v-if="row.coverUrl"
              :src="row.coverUrl"
              fit="cover"
              class="thumb"
              :preview-src-list="[row.coverUrl]"
              preview-teleported
            />
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="素材" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.title || "未命名素材" }}</template>
        </el-table-column>
        <el-table-column label="状态" width="88" align="center">
          <template #default="{ row }">
            <el-tag :type="convertTagType(row.convertStatus)" size="small">{{ convertLabel(row.convertStatus) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="所属书" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.bookId">{{ row.bookName || "—" }} / {{ row.externalBookId }}</span>
            <el-tag v-else type="warning" size="small">未归属</el-tag>
            <el-tag v-if="row.isNew" type="warning" size="small" class="new-tag">新</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="firstSeenAt" label="首次入库" width="170" align="center" />
        <el-table-column label="爆款" width="70" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.latest?.isHot" type="danger" size="small">爆款</el-tag>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="充值" width="90" align="center">
          <template #default="{ row }">{{ fmtNum(row.latest?.rechargeAmount) }}</template>
        </el-table-column>
        <el-table-column label="消耗" width="90" align="center">
          <template #default="{ row }">{{ fmtNum(row.latest?.cost) }}</template>
        </el-table-column>
        <el-table-column label="展示" width="90" align="center">
          <template #default="{ row }">{{ fmtNum(row.latest?.impressions, 0) }}</template>
        </el-table-column>
        <el-table-column label="点击" width="80" align="center">
          <template #default="{ row }">{{ fmtNum(row.latest?.clicks, 0) }}</template>
        </el-table-column>
        <el-table-column label="热度" width="80" align="center">
          <template #default="{ row }">{{ fmtNum(row.heat || row.latest?.heat) }}</template>
        </el-table-column>
        <el-table-column label="原片" width="70" align="center">
          <template #default="{ row }">
            <a v-if="row.playUrl" :href="row.playUrl" target="_blank" rel="noopener" class="link-a">打开</a>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right" align="center">
          <template #default="{ row }">
            <el-button v-if="row.convertStatus === 'collected'" type="primary" link @click="setStatus(row, 'hot')">
              标为爆款
            </el-button>
            <el-button v-if="row.convertStatus === 'hot'" type="primary" link @click="setStatus(row, 'converting')">
              开始转化
            </el-button>
            <el-button
              v-if="row.convertStatus === 'hot' || row.convertStatus === 'converting'"
              type="primary"
              link
              @click="openConverted(row)"
            >
              已转化
            </el-button>
            <el-button
              v-if="row.convertStatus !== 'converted' && row.convertStatus !== 'dropped'"
              type="danger"
              link
              @click="setStatus(row, 'dropped')"
            >
              放弃
            </el-button>
            <el-button v-if="row.convertedUrl" type="primary" link @click="openUrl(row.convertedUrl)">成片</el-button>
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

    <el-dialog v-model="convertVisible" title="回填成片" width="480px" destroy-on-close>
      <el-form label-width="88px">
        <el-form-item label="成片地址" required>
          <el-input v-model="convertForm.convertedUrl" placeholder="成片链接" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="convertForm.convertRemark" type="textarea" :rows="2" maxlength="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="convertVisible = false">取消</el-button>
        <el-button type="primary" :loading="convertSaving" @click="saveConverted">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup name="novelMaterials">
import { useTable } from "@/hooks/useTable"
import CzPagination from "@/components/cz-pagination/index.vue"
import request from "@/request"
import BookSelect from "../components/book-select.vue"
import { CONVERT_STATUS_OPTIONS, convertLabel, convertTagType, fmtNum } from "../shared"

const defaultTableParams = () => ({
  keyword: "",
  bookId: "",
  convertStatus: "",
  isHot: "",
  unassigned: "",
  onlyNew: "",
  pageNo: 1,
  pageSize: 20,
})

const { tableParams, tableData, tableTotal, tableLoading, getTableData, tableSearch, resetTable } = useTable(
  "/admin-api/novel/materials/page",
  defaultTableParams,
)

const convertVisible = ref(false)
const convertSaving = ref(false)
const convertForm = reactive({ id: 0, convertedUrl: "", convertRemark: "" })

onMounted(() => {
  getTableData()
})

async function setStatus(row, convertStatus) {
  const res = await request({
    url: `/admin-api/novel/materials/${row.id}/convert`,
    method: "PATCH",
    data: { convertStatus },
  })
  if (res.code === 0) {
    ElMessage.success("已更新")
    getTableData()
  } else {
    ElMessage.error(res.msg || "更新失败")
  }
}

function openConverted(row) {
  convertForm.id = row.id
  convertForm.convertedUrl = row.convertedUrl || ""
  convertForm.convertRemark = row.convertRemark || ""
  convertVisible.value = true
}

async function saveConverted() {
  if (!convertForm.convertedUrl.trim()) {
    ElMessage.warning("请填写成片地址")
    return
  }
  convertSaving.value = true
  try {
    const res = await request({
      url: `/admin-api/novel/materials/${convertForm.id}/convert`,
      method: "PATCH",
      data: {
        convertStatus: "converted",
        convertedUrl: convertForm.convertedUrl,
        convertRemark: convertForm.convertRemark,
      },
    })
    if (res.code === 0) {
      ElMessage.success("已标记为已转化")
      convertVisible.value = false
      getTableData()
    } else {
      ElMessage.error(res.msg || "保存失败")
    }
  } finally {
    convertSaving.value = false
  }
}

function openUrl(url) {
  window.open(url, "_blank", "noopener")
}
</script>

<style scoped lang="scss">
@use "../novel-page.scss";

.thumb {
  width: 40px;
  height: 54px;
  border-radius: 4px;
}
.new-tag {
  margin-left: 6px;
}
</style>
