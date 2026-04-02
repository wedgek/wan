import request from '@/request'

// 登录
export const loginApi = (data) => {
    return request({
        url: '/admin-api/system/auth/login',
        method: 'POST',
        data
    })
}

// 登出
export const logoutApi = () => {
    return request({
        url: '/admin-api/system/auth/logout',
        method: 'POST',
    })
}

// 获取用户信息
export const getUserInfoApi = () => {
    return request({
        url: '/admin-api/system/auth/get-permission-info',
        method: 'GET',
    })
}

// 刷新Token
export const handleRefreshTokenApi = (refreshToken) => {
    return request({
        url: '/admin-api/system/auth/refresh-token',
        method: 'POST',
        data: { refreshToken },
    })
}
