import { unref } from 'vue'

/**
 * 表格单元格点击 hook
 * @param {Ref} tableRef - 表格引用
 * @param {Object} options - 配置项
 * @param {string|string[]} options.columns - 可点击的列（prop名称），空数组表示所有列
 * @param {string} options.action - 内置行为: 'expand' | 'select'
 * @param {Function} options.handler - 自定义处理函数 (row, column, cell, event, table) => void
 * @param {string[]} options.ignoredSelectors - 忽略的选择器
 * @param {Function} options.condition - 条件判断函数 (row) => boolean
 * 
 * @example
 * // 1. 点击名称列展开/收起（树形表格）
 * const { handleCellClick } = useCellClick(tableRef, {
 *   columns: 'name',
 *   action: 'expand',
 *   condition: (row) => row.children?.length > 0
 * })
 * 
 * // 2. 点击整行勾选
 * const { handleCellClick } = useCellClick(tableRef, { columns: [], action: 'select' })
 * 
 * // 3. 点击多列展开
 * const { handleCellClick } = useCellClick(tableRef, { columns: ['name', 'title'], action: 'expand' })
 * 
 * // 4. 自定义处理
 * const { handleCellClick } = useCellClick(tableRef, {
 *   columns: 'status',
 *   handler: (row, column, cell, event, table) => { modalRef.value?.show(row) }
 * })
 */
export function useCellClick(tableRef, options = {}) {
  const {
    columns = [],
    action = 'expand',
    handler,
    ignoredSelectors = ['button', 'a', '.el-button', '.el-checkbox', '.el-switch', '.el-input'],
    condition = () => true
  } = options

  const targetColumns = Array.isArray(columns) ? columns : [columns]

  const handleCellClick = (row, column, cell, event) => {
    event?.stopPropagation()

    // 检查目标列
    if (targetColumns.length && !targetColumns.includes(column.property)) return

    // 检查忽略元素
    if (event?.target && ignoredSelectors.some(sel => event.target.closest(sel))) return

    // 检查条件
    if (!condition(row, column)) return

    const table = unref(tableRef)
    if (!table) return

    // 自定义处理优先
    if (handler) {
      handler(row, column, cell, event, table)
      return
    }

    // 内置行为
    if (action === 'expand') {
      table.toggleRowExpansion(row)
    } else if (action === 'select') {
      table.toggleRowSelection(row)
    }
  }

  return { handleCellClick }
}

