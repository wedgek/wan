import { nextTick } from 'vue';

export const requiredDot = {
  mounted(el, binding) {
    if (binding.value === false) return;

    nextTick(() => {
      const label = el.querySelector('.el-form-item__label');
      if (!label) return;

      // 给 label 设置 flex 布局实现垂直居中
      label.style.display = 'inline-flex';
      label.style.alignItems = 'center';

      // 创建红点
      const dot = document.createElement('span');
      dot.style.flexShrink = '0';
      dot.style.width = '4px';
      dot.style.height = '4px';
      dot.style.backgroundColor = '#f5222d';
      dot.style.borderRadius = '50%';
      dot.style.marginRight = '8px';

      // 插入到 label 文字最前面
      label.insertBefore(dot, label.firstChild);
    });
  },
};
