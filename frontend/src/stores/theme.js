import { defineStore } from 'pinia'
import { getStorage, setStorage } from '@/utils/storage'

const STORAGE_KEY = 'app-appearance'

export const useThemeStore = defineStore('theme', () => {
  const appearance = ref('light')
  const systemDark = ref(
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  )

  let mql

  const resolvedDark = computed(() => {
    if (appearance.value === 'dark') return true
    if (appearance.value === 'light') return false
    return systemDark.value
  })

  function syncSystem() {
    if (typeof window === 'undefined') return
    systemDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  function onSystemChange(e) {
    systemDark.value = e.matches
  }

  function applyDom() {
    if (typeof document === 'undefined') return
    document.documentElement.classList.toggle('dark', resolvedDark.value)
  }

  watch(resolvedDark, applyDom, { immediate: true })

  function initTheme() {
    const saved = getStorage(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'auto') {
      appearance.value = saved
    }
    syncSystem()
    if (typeof window !== 'undefined') {
      mql = window.matchMedia('(prefers-color-scheme: dark)')
      mql.addEventListener('change', onSystemChange)
    }
    applyDom()
  }

  function setAppearance(mode) {
    if (mode !== 'light' && mode !== 'dark' && mode !== 'auto') return
    appearance.value = mode
    setStorage(STORAGE_KEY, mode)
  }

  return {
    appearance,
    resolvedDark,
    initTheme,
    setAppearance,
  }
})
