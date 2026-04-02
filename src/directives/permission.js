import { checkPermission } from "@/utils/permission"

export const permissionDirective = {
  mounted(el, binding) {
    const { value } = binding

    if (value && value instanceof Array && value.length > 0) {
      const hasPermission = checkPermission(value)

      if (!hasPermission) {
        el.style.display = "none"
      }
    } else {
      throw new Error("需要权限！用法如 v-permission=\"['user:add','user:edit']\"")
    }
  },
}
