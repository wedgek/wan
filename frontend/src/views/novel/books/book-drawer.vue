<template>
  <el-drawer v-model="visible" :title="title" size="min(920px, 96vw)" destroy-on-close @closed="onClosed">
    <div v-loading="loading" class="drawer-body">
      <template v-if="detail">
        <div class="meta-row">
          <el-tag v-if="detail.book.store" type="info" size="small">{{ detail.book.store }}</el-tag>
          <el-tag :type="detail.book.launchStatus === 'launched' ? 'success' : 'info'" size="small">
            {{ launchLabel(detail.book.launchStatus) }}
          </el-tag>
          <span class="muted">书籍 ID {{ detail.book.externalBookId || "—" }}</span>
          <span class="muted">作者 {{ detail.book.author || "—" }}</span>
          <span class="muted">首次入库 {{ detail.book.firstSeenAt || "—" }}</span>
        </div>

        <el-tabs v-model="tab">
          <el-tab-pane :label="`效果快照 (${detail.snapshots.length})`" name="snap">
            <el-table :data="detail.snapshots" border size="small" max-height="460">
              <el-table-column prop="statDate" label="统计日" width="110" align="center" />
              <el-table-column label="时段" width="80" align="center">
                <template #default="{ row }">{{ slotLabel(row.slot) }}</template>
              </el-table-column>
              <el-table-column label="爆款" width="70" align="center">
                <template #default="{ row }">
                  <el-tag v-if="row.isHot" type="danger" size="small">爆款</el-tag>
                  <span v-else class="muted">—</span>
                </template>
              </el-table-column>
              <el-table-column label="充值金额" min-width="100" align="center">
                <template #default="{ row }">{{ fmtNum(row.rechargeAmount) }}</template>
              </el-table-column>
              <el-table-column label="充值人数" width="90" align="center">
                <template #default="{ row }">{{ fmtNum(row.rechargeUsers, 0) }}</template>
              </el-table-column>
              <el-table-column label="充值订单" width="90" align="center">
                <template #default="{ row }">{{ fmtNum(row.rechargeOrders, 0) }}</template>
              </el-table-column>
              <el-table-column label="人均订单" width="90" align="center">
                <template #default="{ row }">{{ fmtNum(row.avgOrders) }}</template>
              </el-table-column>
              <el-table-column label="首充订单" width="90" align="center">
                <template #default="{ row }">{{ fmtNum(row.firstRechargeOrders, 0) }}</template>
              </el-table-column>
              <el-table-column label="ARPU" width="80" align="center">
                <template #default="{ row }">{{ fmtNum(row.arpu) }}</template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane :label="`素材 (${detail.materials.length})`" name="mat">
            <el-table :data="detail.materials" border size="small" max-height="460">
              <el-table-column label="封面" width="72" align="center">
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
              <el-table-column prop="title" label="素材" min-width="160" show-overflow-tooltip />
              <el-table-column label="状态" width="88" align="center">
                <template #default="{ row }">
                  <el-tag :type="convertTagType(row.convertStatus)" size="small">
                    {{ convertLabel(row.convertStatus) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="充值" width="88" align="center">
                <template #default="{ row }">{{ fmtNum(row.latest?.rechargeAmount) }}</template>
              </el-table-column>
              <el-table-column label="消耗" width="88" align="center">
                <template #default="{ row }">{{ fmtNum(row.latest?.cost) }}</template>
              </el-table-column>
              <el-table-column label="热度" width="80" align="center">
                <template #default="{ row }">{{ fmtNum(row.heat || row.latest?.heat) }}</template>
              </el-table-column>
              <el-table-column label="链接" min-width="140">
                <template #default="{ row }">
                  <a v-if="row.playUrl" :href="row.playUrl" target="_blank" rel="noopener" class="link-a">打开</a>
                  <span v-else class="muted">—</span>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane :label="`推广链接 (${detail.promoLinks.length})`" name="promo">
            <div class="promo-head">
              <el-button type="primary" size="small" :icon="$icons.Plus" @click="promoVisible = true">创建链接</el-button>
            </div>
            <el-table :data="detail.promoLinks" border size="small" max-height="420">
              <el-table-column prop="name" label="名称" min-width="120" show-overflow-tooltip>
                <template #default="{ row }">{{ row.name || "—" }}</template>
              </el-table-column>
              <el-table-column label="path" min-width="220" show-overflow-tooltip>
                <template #default="{ row }">{{ row.path || row.url || "—" }}</template>
              </el-table-column>
              <el-table-column label="媒体" width="80" align="center">
                <template #default="{ row }">{{ mediaSourceLabel(row.mediaSource) }}</template>
              </el-table-column>
              <el-table-column label="来源" width="80" align="center">
                <template #default="{ row }">{{ sourceLabel(row.source) }}</template>
              </el-table-column>
              <el-table-column label="操作" width="120" align="center">
                <template #default="{ row }">
                  <el-button v-if="row.path || row.url" type="primary" link @click="copyText(row.path || row.url)">复制</el-button>
                  <el-button type="danger" link @click="onDeletePromo(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </template>
    </div>

    <PromoCreateDialog
      v-if="detail?.book?.id"
      v-model="promoVisible"
      :book-id="detail.book.id"
      @created="onPromoCreated"
    />
  </el-drawer>
</template>

<script setup>
import request from "@/request"
import PromoCreateDialog from "../components/promo-create-dialog.vue"
import { convertLabel, convertTagType, copyText, fmtNum, launchLabel, mediaSourceLabel, slotLabel, sourceLabel } from "../shared"

const visible = ref(false)
const loading = ref(false)
const detail = ref(null)
const tab = ref("mat")
const promoVisible = ref(false)

const title = computed(() => (detail.value?.book?.name ? detail.value.book.name : "书籍详情"))

async function show(bookId, nextTab) {
  visible.value = true
  tab.value = nextTab || "mat"
  loading.value = true
  detail.value = null
  try {
    const res = await request({ url: `/admin-api/novel/books/${bookId}`, method: "GET" })
    if (res.code === 0) detail.value = res.data
    else ElMessage.error(res.msg || "读取失败")
  } finally {
    loading.value = false
  }
}

function onClosed() {
  detail.value = null
}

async function onPromoCreated() {
  if (detail.value?.book?.id) {
    await show(detail.value.book.id, "promo")
  }
}

async function onDeletePromo(row) {
  try {
    await ElMessageBox.confirm("是否删除该推广链接？", "提示", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      type: "warning",
    })
    const res = await request({ url: `/admin-api/novel/promo-links/${row.id}`, method: "DELETE" })
    if (res.code === 0) {
      ElMessage.success("已删除")
      if (detail.value?.book?.id) {
        await show(detail.value.book.id)
        tab.value = "promo"
      }
    } else {
      ElMessage.error(res.msg || "删除失败")
    }
  } catch (_) {
    /* 取消 */
  }
}

defineExpose({ show })
</script>

<style scoped lang="scss">
.drawer-body {
  min-height: 240px;
  padding: 0 4px;
}
.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 16px;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.thumb {
  width: 36px;
  height: 48px;
  border-radius: 4px;
}
.link-a {
  color: var(--el-color-primary);
}
.promo-head {
  margin-bottom: 8px;
}
</style>
