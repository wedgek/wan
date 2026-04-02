// iconfont Symbol CDN 链接
export const iconfontUrl = '//at.alicdn.com/t/c/font_5122308_u8l9cwsolne.js'

// NPM 包 CDN 配置
export const cdnModules = [
  {
    name: 'ali-oss',
    var: 'OSS',
    path: 'https://registry.npmmirror.com/ali-oss/6.23.0/files/dist/aliyun-oss-sdk.min.js',
  },
  {
    name: 'dayjs',
    var: 'dayjs',
    path: 'https://registry.npmmirror.com/dayjs/1.11.19/files/dayjs.min.js',
  },
  {
    name: 'axios',
    var: 'axios',
    path: 'https://registry.npmmirror.com/axios/1.13.2/files/dist/axios.min.js',
  },
  {
    name: 'cropperjs',
    var: 'Cropper',
    path: 'https://registry.npmmirror.com/cropperjs/1.6.2/files/dist/cropper.min.js',
  },
]

// 需要 external 的包名
export const cdnExternal = ['ali-oss', 'dayjs', 'axios', 'cropperjs']

// CDN 全局变量映射
export const cdnGlobals = {
  'ali-oss': 'OSS',
  'dayjs': 'dayjs',
  'axios': 'axios',
  'cropperjs': 'Cropper',
}

// 从预构建中排除的依赖
export const cdnExclude = ['ali-oss', 'dayjs', 'axios', 'cropperjs']