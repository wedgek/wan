import request from '@/request'
import { urlEncode } from "@/utils/public";

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