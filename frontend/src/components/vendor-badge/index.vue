<template>
  <div class="vendor-badge" :class="{ 'vendor-badge--compact': compact }" :title="brand.label">
    <img
      v-if="brand.logo"
      class="vendor-badge__logo"
      :src="brand.logo"
      :alt="brand.label"
      loading="lazy"
    />
    <span v-else class="vendor-badge__icon" :style="{ color: brand.color, background: brand.bg }">
      {{ brand.abbr }}
    </span>
    <span v-if="showLabel" class="vendor-badge__label">{{ brand.label }}</span>
  </div>
</template>

<script setup>
import { computed } from "vue"
import { getVendorBrand } from "@/utils/vendorBrand"

const props = defineProps({
  vendor: { type: String, default: "" },
  apiModelId: { type: String, default: "" },
  showLabel: { type: Boolean, default: true },
  compact: { type: Boolean, default: false },
})

const brand = computed(() => getVendorBrand(props.vendor, props.apiModelId))
</script>

<style scoped lang="scss">
.vendor-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
}
.vendor-badge__logo {
  display: block;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  object-fit: contain;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  box-sizing: border-box;
  padding: 2px;
}
.vendor-badge__icon {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  line-height: 22px;
  text-align: center;
}
.vendor-badge__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 22px;
}
.vendor-badge--compact {
  gap: 4px;
  .vendor-badge__logo,
  .vendor-badge__icon {
    width: 18px;
    height: 18px;
    line-height: 18px;
    font-size: 10px;
  }
  .vendor-badge__label {
    font-size: 12px;
    line-height: 18px;
  }
}
</style>
