import { unref } from 'vue'

export function useRowSelection(tableRef, selectedIds, ignoredSelectors = ['button', 'a', 'input', 'textarea', 'select']) {
  const handleSelectionChange = (rows) => {
    selectedIds.value = (rows || []).map(item => item.id).filter(Boolean)
  }

  const handleRowClick = (row, column, event) => {
    const table = unref(tableRef)
    if (!table || !row) return

    // 判断点击来源，如果是操作元素就不触发选中
    if (event?.target && ignoredSelectors.some(sel => event.target.closest(sel))) return

    table.toggleRowSelection(row)
  }

  const clearSelection = () => {
    const table = unref(tableRef)
    table?.clearSelection()
    selectedIds.value = []
  }

  return { handleSelectionChange, handleRowClick, clearSelection }
}
