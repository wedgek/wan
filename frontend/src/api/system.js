import request from '@/request'
import { urlEncode } from "@/utils/public";

/** 工作台概览统计 */
export const getWorkbenchSummaryApi = () => {
  return request({
    url: '/admin-api/system/workbench-summary',
    method: 'GET',
  })
}

/** 工作台快捷入口（当前用户，服务端持久化） */
export const getWorkbenchQuickEntriesApi = () => {
  return request({
    url: '/admin-api/system/quick-entries',
    method: 'GET',
  })
}

export const saveWorkbenchQuickEntriesApi = (menuIds) => {
  return request({
    url: '/admin-api/system/quick-entries',
    method: 'PUT',
    data: { menuIds },
  })
}

// 获取菜单列表
export const getMenuApi = () => {
  return request({
    url: '/admin-api/system/menu/list-all-simple',
    method: 'GET',
  })
}

// 获取部门列表
export const getDepartmentApi = () => {
  return request({
    url: '/admin-api/system/dept/list-all-simple',
    method: 'GET',
  })
}

// 获取角色列表
export const getRoleApi = () => {
  return request({
    url: '/admin-api/system/role/list-all-simple',
    method: 'GET',
  })
}

// 获取用户列表
export const getUserApi = (params) => {
  return request({
    url: '/admin-api/system/user/list-all-simple?' + urlEncode(params),
    method: 'GET',
  })
}

// 更新头像
export const updateUserAvatarApi = (id, avatar) => {
  return request({
    url: '/admin-api/system/user/updateAvatar',
    method: 'PUT',
    data: { id, avatar }
  })
}