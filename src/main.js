import { createApp } from "vue"
import { createPinia } from "pinia"
import App from "./App.vue"
import router from "./router"

import "element-plus/dist/index.css"
import "./styles/index.scss"
import directives from "./directives"
import { registerIcons } from "./plugins/icons.js"
import { initPermission } from "./router/permission"

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.use(directives)
registerIcons(app)

// 初始化权限数据
await initPermission()

app.mount("#app")
