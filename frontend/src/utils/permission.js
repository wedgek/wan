import { useAuthStore } from "@/stores/auth.js"

export const checkPermission = (permissions) => {
  const authStore = useAuthStore()
  const userPermissions = authStore.permissions

  if (!Array.isArray(permissions)) {
    permissions = [permissions]
  }

  return permissions.some((permission) => userPermissions.includes(permission))
}

export const checkRole = (roles) => {
  const authStore = useAuthStore()
  const userRoles = authStore.roles

  if (!Array.isArray(roles)) {
    roles = [roles]
  }

  return roles.some((role) => userRoles.includes(role))
}
