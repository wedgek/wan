import { ElMessage, ElMessageBox } from 'element-plus';
import request from '@/request';

export function useDelete({ url, paramKey = 'id', method = 'DELETE', refresh }) {
  const deleteById = async (id) => {
    if (!id) return;

    try {
      await ElMessageBox.confirm('是否删除选中数据？', '提示', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      });

      const config = { url, method };
      
      // DELETE: 参数拼接URL，POST: 参数放body
      if (method === 'POST') {
        config.data = { [paramKey]: id };
      } else {
        config.url = `${url}?${paramKey}=${id}`;
      }

      const res = await request(config);

      if (res.code === 0) {
        ElMessage.success('删除成功');
        if (refresh) {
          if (Array.isArray(refresh)) {
            refresh.forEach(cb => {
              if (typeof cb === 'function') cb();
            });
          } else if (typeof refresh === 'function') {
            refresh();
          }
        }
      } else {
        ElMessage.error(res.msg || '删除失败');
      }
    } catch (_) {}
  };

  return deleteById;
}

