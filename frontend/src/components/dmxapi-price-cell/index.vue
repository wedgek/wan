<template>
  <div class="dmxapi-price-cell">
    <template v-if="!display || display.kind === 'empty'">
      <span v-if="fallbackText" class="dmxapi-price-cell__fallback">{{ fallbackText }}</span>
      <span v-else class="muted">—</span>
    </template>

    <template v-else-if="display.kind === 'free'">
      <div class="dmxapi-price-cell__fixed">
        <span>{{ display.prefix }}</span>
        <el-tag v-if="display.badge" size="small" type="success" class="free-tag">{{ display.badge }}</el-tag>
      </div>
    </template>

    <template v-else-if="display.kind === 'fixed'">
      <div class="dmxapi-price-cell__fixed">{{ display.prefix }}</div>
    </template>

    <template v-else-if="display.kind === 'token'">
      <div class="dmxapi-price-cell__token">
        <div v-if="display.title" class="dmxapi-price-cell__token-title">{{ display.title }}</div>
        <div v-for="(line, i) in display.lines || []" :key="i" class="dmxapi-price-cell__token-line">{{ line }}</div>
      </div>
    </template>

    <template v-else-if="display.kind === 'table'">
      <div class="dmxapi-price-cell__table-wrap">
        <table class="dmxapi-price-table">
          <thead>
            <tr>
              <th v-for="col in display.columns || []" :key="col">{{ col }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, ri) in display.rows || []" :key="ri">
              <td v-for="(cell, ci) in rowCells(row)" :key="ci">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup>
const props = defineProps({
  display: { type: Object, default: null },
  fallbackText: { type: String, default: "" },
})

function rowCells(row) {
  if (Array.isArray(row)) return row
  if (row && Array.isArray(row.cells)) return row.cells
  return []
}
</script>

<style lang="scss" scoped>
.dmxapi-price-cell {
  line-height: 1.5;
  font-size: 12px;
  color: var(--el-text-color-regular);

  &__fixed {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  &__token-title {
    font-weight: 500;
    color: var(--el-text-color-primary);
    margin-bottom: 2px;
  }

  &__token-line {
    color: var(--el-text-color-regular);
  }

  &__fallback {
    white-space: normal;
    word-break: break-word;
  }

  &__table-wrap {
    overflow-x: auto;
    max-width: 100%;
  }
}

.free-tag {
  border: none;
}

.dmxapi-price-table {
  width: max-content;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 11px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  overflow: hidden;

  th,
  td {
    border-right: 1px solid var(--el-border-color-lighter);
    border-bottom: 1px solid var(--el-border-color-lighter);
    padding: 5px 8px;
    text-align: center;
    vertical-align: middle;
    white-space: normal;
    word-break: break-word;
    line-height: 1.45;
  }

  th:last-child,
  td:last-child {
    border-right: none;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  th:first-child,
  td:first-child {
    text-align: left;
    min-width: 72px;
  }

  th {
    background: var(--el-fill-color-light);
    font-weight: 500;
    color: var(--el-text-color-secondary);
  }

  td {
    color: var(--el-text-color-regular);
  }
}

.muted {
  color: var(--el-text-color-placeholder);
}
</style>
