import NProgress from 'nprogress'
import 'nprogress/nprogress.css'

export function setupNProgress() {
  NProgress.configure({
    showSpinner: false,
    trickleSpeed: 200,
    minimum: 0.08,
    easing: 'linear',
  })
  
  // 设置颜色
  setNProgressColor('#4078fc')
  
  return NProgress
}

export function setNProgressColor(color) {
  if (typeof document === 'undefined') return
  
  const styleId = 'nprogress-custom-color'
  let style = document.getElementById(styleId)
  
  if (!style) {
    style = document.createElement('style')
    style.id = styleId
    document.head.appendChild(style)
  }
  
  style.innerHTML = `
    #nprogress .bar { background: ${color}; }
    #nprogress .peg { box-shadow: 0 0 10px ${color}, 0 0 5px ${color}; }
  `
}