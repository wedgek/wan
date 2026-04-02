import { ElMessage, ElMessageBox } from 'element-plus';
import request from '@/request';

/**
 * useBatchAction
 * @param {Object} options
 *   - url: 请求地址
 *   - tableRef: 可选，用于清空选中 
 *   - refresh: 可选，操作成功后的刷新函数
 *   - successText: 可选，成功提示
 *   - getConfirmText: 可选，返回确认框文字
 */
export function useBatchAction({ url, tableRef, refresh, successText = '操作成功', getConfirmText }) {
  return async (payload = {}) => {
    const ids = payload.ids;

    if (!ids || !ids.length) {
      ElMessage('请先勾选要操作的数据');
      return;
    }

    try {
      const confirmText = getConfirmText ? getConfirmText(payload) : '是否执行该操作？';

      await ElMessageBox.confirm(confirmText, '提示', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      });

      const res = await request({
        url,
        method: 'POST',
        data: payload, 
      });

      if (res.code === 0) {
        ElMessage.success(successText);
        tableRef?.value?.clearSelection?.();
        refresh?.();
      } else {
        ElMessage.error(res.msg);
      }
    } catch (_) {}
  };
}
