/* ================== 动态路由映射 ================== */
export const routeComponents = {
  // 系统权限
  managePermissionMenu: () => import("@/views/manage/permission/menu/index.vue"),
  managePermissionRole: () => import("@/views/manage/permission/role/index.vue"),
  managePermissionMember: () => import("@/views/manage/permission/member/index.vue"),
  // AI
  aiPromptManage: () => import("@/views/ai/prompts/index.vue"),
  aiVideoCanvas: () => import("@/views/ai/canvas/index.vue"),
  aiVideoStudio: () => import("@/views/ai/studio/index.vue"),
  aiVideoChat: () => import("@/views/ai/video-chat/index.vue"),
  aiVideoModelManage: () => import("@/views/ai/video-models/index.vue"),
}


/* ================== 静态路由 ================== */
export const staticRoutes = [
  {
    path: "/",
    redirect: "/home",
  },
  {
    path: "/home",
    name: "Home",
    component: () => import("@/views/home/index.vue"),
    meta: {
      requiresAuth: true,
      showNavbar: true,
      showSidebar: true,
      title: "工作台",
      /** 主内容区横向更贴边，工作台占满侧栏右侧区域 */
      wideContent: true,
    },
  },
  {
    path: "/profile",
    name: "Profile",
    component: () => import("@/views/profile/index.vue"),
    meta: {
      requiresAuth: true,
      showNavbar: true,
      showSidebar: true,
      title: "个人中心",
    },
  },
  {
    path: "/login",
    name: "Login",
    component: () => import("@/views/login.vue"),
    meta: {
      requiresAuth: false,
      showNavbar: false,
      showSidebar: false,
      noPadding: true,
    },
  },
  {
    path: "/ai/canvas",
    redirect: "/ai/studio",
    meta: { requiresAuth: true },
  },
  {
    path: "/ai/video",
    redirect: "/ai/studio",
    meta: { requiresAuth: true },
  },
  /** 与后台默认菜单 path 一致；静态注册避免动态路由偶发未挂上时侧栏点击无页面 */
  {
    path: "/ai/prompts",
    name: "menuAiPrompts",
    component: () => import("@/views/ai/prompts/index.vue"),
    meta: {
      requiresAuth: true,
      showNavbar: true,
      showSidebar: true,
      title: "提示词管理",
    },
  },
  {
    path: "/ai/video-chat",
    name: "menuAiVideoChat",
    component: () => import("@/views/ai/video-chat/index.vue"),
    meta: {
      requiresAuth: true,
      showNavbar: true,
      showSidebar: true,
      title: "对话创作",
      wideContent: true,
      noPadding: true,
    },
  },
  {
    path: "/ai/studio",
    name: "menuAiStudio",
    component: () => import("@/views/ai/studio/index.vue"),
    meta: {
      requiresAuth: true,
      showNavbar: true,
      showSidebar: true,
      title: "工作流",
    },
  },
  {
    path: "/ai/video-models",
    name: "menuAiVideoModels",
    component: () => import("@/views/ai/video-models/index.vue"),
    meta: {
      requiresAuth: true,
      showNavbar: true,
      showSidebar: true,
      title: "模型管理",
    },
  },
]

/** 已由 staticRoutes 注册的路径，addDynamicRoutes 中不再 addRoute，防止重复记录 */
export const staticMenuRoutePaths = new Set([
  "/ai/prompts",
  "/ai/video-chat",
  "/ai/studio",
  "/ai/video-models",
])


/* ================== 404 路由 ================== */
export const notFoundRoute = {
  path: "/:pathMatch(.*)*",
  name: "404",
  component: () => import("@/views/404.vue"),
  meta: {
    requiresAuth: true,
    showNavbar: false,
    showSidebar: false,
    noPadding: true,
  },
}


/* ================== 参数说明 ================== */
// requiresAuth 权限
// showNavbar 展示导航
// showSidebar 展示侧边
// noPadding 默认主边距
