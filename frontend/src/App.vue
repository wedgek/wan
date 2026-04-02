<template>
  <el-config-provider v-bind="config">
    <Layout>
      <router-view />
    </Layout>
  </el-config-provider>
</template>

<script setup>
import Layout from "@/layout/index.vue"
import { useElementStore } from "@/stores/element"

const element = useElementStore()
const config = {
  locale: element.locale,
  card: element.card,
  message: element.message,
}

onMounted(() => {
  const loading = document.getElementById("initial-loading")
  if (!loading) return
  loading.style.opacity = "0"
  setTimeout(() => loading.remove(), 300)
})
</script>