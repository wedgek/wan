<template>
  <div class="page-container novel-page ocean-events">
    <EventPanel :authorized="authorized" :auth-ready="authReady" />
  </div>
</template>

<script setup name="novelOceanEvents">
import request from "@/request"
import EventPanel from "../ocean-settings/event-panel.vue"

const authorized = ref(false)
const authReady = ref(false)

onMounted(load)

async function load() {
  try {
    const res = await request({
      url: "/admin-api/oceanengine/settings",
      timeout: 30000,
      params: { scope: "auth" },
    })
    if (res.code !== 0) return
    authorized.value = !!(res.data && res.data.authorized)
  } finally {
    authReady.value = true
  }
}
</script>

<style scoped lang="scss">
.ocean-events {
  min-height: 0;
}
</style>
