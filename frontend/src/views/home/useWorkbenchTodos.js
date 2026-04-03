import { ref, watch, computed } from "vue"
import { getStorage, setStorage } from "@/utils/storage"

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * 工作台待办：按用户 id 分 key 持久化到 localStorage
 * @param {import('vue').Ref<string|number>} userIdRef
 */
export function useWorkbenchTodos(userIdRef) {
  const todos = ref([])

  const storageKey = computed(() => {
    const id = userIdRef.value
    return `workbench-todos-${id === undefined || id === null ? "guest" : String(id)}`
  })

  const load = () => {
    const raw = getStorage(storageKey.value)
    todos.value = Array.isArray(raw) ? raw : []
  }

  watch(
    storageKey,
    () => load(),
    { immediate: true },
  )

  watch(
    todos,
    (v) => {
      setStorage(storageKey.value, v)
    },
    { deep: true },
  )

  const add = (text) => {
    const t = String(text || "").trim()
    if (!t) return
    todos.value.push({
      id: uid(),
      text: t,
      done: false,
      createdAt: Date.now(),
    })
  }

  const remove = (id) => {
    const i = todos.value.findIndex((x) => x.id === id)
    if (i !== -1) todos.value.splice(i, 1)
  }

  const stats = computed(() => {
    const total = todos.value.length
    const done = todos.value.filter((x) => x.done).length
    return {
      total,
      done,
      rate: total ? Math.round((done / total) * 100) : 0,
    }
  })

  return { todos, add, remove, stats, load }
}
