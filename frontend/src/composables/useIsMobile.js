import { ref } from "vue"

/** 与顶栏 / 布局共用的移动端断点（<768px） */
const MQ = "(max-width: 767.98px)"

export const isMobileViewport = ref(false)

if (typeof window !== "undefined") {
  const mq = window.matchMedia(MQ)
  isMobileViewport.value = mq.matches
  mq.addEventListener("change", () => {
    isMobileViewport.value = mq.matches
  })
}

export function useIsMobile() {
  return { isMobile: isMobileViewport }
}
