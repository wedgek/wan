import { reactive, ref } from 'vue';
import { debounce, resetState, cloneDeep, filterEmptyValueShallow } from '@/utils';
import { urlEncode } from '@/utils/public';
import request from '@/request';

/**
 * 表格数据 hook
 * @param {string} fetchUrl - 请求地址
 * @param {Function} defaultParamsFn - 默认参数函数
 * @param {Object} options - 配置项
 * @param {boolean} options.pagination - 是否分页，默认 true
 * @param {Function} options.transformParams - 自定义参数转换
 * @param {Function} options.onSuccess - 完全自定义响应处理 (data, { tableData, tableTotal }) => void
 */
export function useTable(fetchUrl, defaultParamsFn, options = {}) {
    const tableParams = reactive(defaultParamsFn());
    const tableData = ref([]);
    const tableTotal = ref(0);
    const tableLoading = ref(false);

    const { pagination = true, transformParams, onSuccess } = options;

    let needRefresh = false;

    const fetchTableData = async () => {
        if (tableLoading.value) {
            // 请求中有新调用，标记一下
            needRefresh = true;
            return;
        }
        tableLoading.value = true;
        // 开始请求，清除标记
        needRefresh = false;

        try {
            let params = cloneDeep(tableParams);

            // 处理时间区间
            if (params.createTime?.length) {
                params.createTime[0] += ' 00:00:00';
                params.createTime[1] += ' 23:59:59';
            }

            // 过滤空值
            params = filterEmptyValueShallow(params);

            // 可自定义参数转换
            if (transformParams) params = transformParams(params);

            const res = await request({
                url: fetchUrl + '?' + urlEncode(params),
                method: 'GET',
            });

            if (res.code === 0) {
                // 三种模式处理响应数据
                if (onSuccess) {
                    // 完全自定义：由外部处理
                    onSuccess(res.data, { tableData, tableTotal });
                } else if (pagination) {
                    // 分页模式：取 res.data.list 和 res.data.total
                    tableData.value = res.data.list;
                    tableTotal.value = res.data.total;
                } else {
                    // 不分页模式：直接取 res.data
                    tableData.value = res.data;
                    tableTotal.value = 0;
                }
            } else {
                ElMessage.error(res.msg);
            }
        } catch (err) {
            console.error(err);
            ElMessage.error('网络错误，请稍后重试');
        } finally {
            tableLoading.value = false;
            // 请求完成后检查，有标记就重新请求
            if (needRefresh) fetchTableData();
        }
    };

    // 防抖：首次立即执行
    const getTableData = debounce(fetchTableData, 300, { leading: true });

    // 搜索
    const tableSearch = () => {
        tableParams.pageNo = 1;
        getTableData();
    };

    // 重置（保留 pageSize）
    const resetTable = () => {
        const currentPageSize = tableParams.pageSize;
        resetState(tableParams, defaultParamsFn());
        tableParams.pageSize = currentPageSize;
        getTableData();
    };

    return { tableParams, tableData, tableTotal, tableLoading, getTableData, tableSearch, resetTable };
}
