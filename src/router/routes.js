/* ================== 动态路由映射 ================== */
export const routeComponents = {
  // 系统权限
  managePermissionMenu: () => import("@/views/manage/permission/menu/index.vue"),
  managePermissionRole: () => import("@/views/manage/permission/role/index.vue"),
  managePermissionMember: () => import("@/views/manage/permission/member/index.vue"),
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
      showSidebar: false,
    },
  },
  {
    path: "/profile",
    name: "Profile",
    component: () => import("@/views/profile/index.vue"),
    meta: {
      requiresAuth: true,
      showNavbar: true,
      showSidebar: false,
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
]


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
