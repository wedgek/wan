<template>
  <div class="canvas-redirect" />
</template>

<script setup name="aiVideoCanvas">
import { onMounted } from "vue"
import { useRouter } from "vue-router"

const router = useRouter()
onMounted(() => {
  router.replace({ path: "/ai/studio" })
})
</script>

<style scoped lang="scss">
.canvas-redirect {
  min-height: 120px;
}
</style>
