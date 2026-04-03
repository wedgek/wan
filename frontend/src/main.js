import { createApp } from "vue"
import { createPinia } from "pinia"
import App from "./App.vue"
import router from "./router"

import "@fontsource/sora/latin-400.css"
import "@fontsource/sora/latin-500.css"
import "@fontsource/sora/latin-600.css"
import "@fontsource/sora/latin-700.css"
import "element-plus/dist/index.css"
import "element-plus/theme-chalk/dark/css-vars.css"
import "./styles/index.scss"
import directives from "./directives"
import { registerIcons } from "./plugins/icons.js"
import { initPermission } from "./router/permission"
import { useThemeStore } from "./stores/theme"

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
useThemeStore().initTheme()

// 须在 app.use(router) 之前完成：避免首跳与动态路由注册竞态导致闪现内部布局/空页面
await initPermission()

app.use(router)
app.use(directives)
registerIcons(app)
await router.isReady()

app.mount("#app")
