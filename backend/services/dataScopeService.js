/**
 * 用户数据范围：合并多角色 data_scope，供成员/部门/创作日志等 API 过滤。
 */
const db = require('../db')

const SUPER_ADMIN_ROLE_ID = 1
const BUILTIN_ADMIN_USER_ID = 1

function getDb() {
  return db.getDb()
}

function isSuperAdmin(userId) {
  const uid = Number(userId)
  if (!uid) return false
  const row = getDb()
    .prepare('SELECT 1 FROM user_roles WHERE user_id = ? AND role_id = ? LIMIT 1')
    .get(uid, SUPER_ADMIN_ROLE_ID)
  return !!row
}

function getUserDeptId(userId) {
  const row = getDb().prepare('SELECT dept_id FROM users WHERE id = ?').get(Number(userId))
  const did = row ? Number(row.dept_id) : 0
  return did > 0 ? did : 0
}

/** @returns {{ id: number, parent_id: number }[]} */
function allDepartments() {
  return getDb().prepare('SELECT id, parent_id FROM departments').all()
}

/** 部门 id 及其所有子孙部门 */
function collectDeptSubtree(deptId, deptRows) {
  const roots = new Set([Number(deptId)])
  if (!roots.size || !deptId) return []
  const byParent = new Map()
  for (const d of deptRows) {
    const pid = Number(d.parent_id) || 0
    if (!byParent.has(pid)) byParent.set(pid, [])
    byParent.get(pid).push(Number(d.id))
  }
  const out = new Set()
  const queue = [Number(deptId)]
  while (queue.length) {
    const id = queue.shift()
    if (out.has(id)) continue
    out.add(id)
    const children = byParent.get(id) || []
    for (const c of children) queue.push(c)
  }
  return [...out]
}

/** 为树展示：可见部门 + 其所有祖先 */
function expandDeptIdsWithAncestors(deptIds, deptRows) {
  const byId = new Map(deptRows.map((d) => [Number(d.id), Number(d.parent_id) || 0]))
  const out = new Set()
  for (const id of deptIds) {
    let cur = Number(id)
    while (cur && !out.has(cur)) {
      out.add(cur)
      cur = byId.get(cur) || 0
    }
  }
  return [...out]
}

const SCOPE_RANK = { all: 4, depts: 3, self: 1 }

/**
 * @param {number} userId
 * @returns {{ mode: 'all'|'depts'|'self', deptIds: number[], isSuperAdmin: boolean }}
 */
function resolveDataScope(userId) {
  const uid = Number(userId)
  if (!uid) return { mode: 'self', deptIds: [], isSuperAdmin: false }

  if (isSuperAdmin(uid)) {
    return { mode: 'all', deptIds: [], isSuperAdmin: true }
  }

  const roleRows = getDb()
    .prepare(
      `SELECT r.id, r.data_scope
       FROM roles r
       INNER JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = ? AND r.status = 0`,
    )
    .all(uid)

  if (!roleRows.length) {
    return { mode: 'self', deptIds: [], isSuperAdmin: false }
  }

  const deptRows = allDepartments()
  const userDeptId = getUserDeptId(uid)
  let bestMode = 'self'
  const deptIdSet = new Set()

  for (const role of roleRows) {
    const scope = Number(role.data_scope) || 5
    if (scope === 1) {
      return { mode: 'all', deptIds: [], isSuperAdmin: false }
    }
    if (scope === 2) {
      const ids = getDb()
        .prepare('SELECT dept_id FROM role_data_scope_depts WHERE role_id = ?')
        .all(role.id)
        .map((x) => Number(x.dept_id))
        .filter((x) => x > 0)
      for (const id of ids) deptIdSet.add(id)
      if (ids.length && SCOPE_RANK.depts > SCOPE_RANK[bestMode]) bestMode = 'depts'
    } else if (scope === 3) {
      if (userDeptId) {
        deptIdSet.add(userDeptId)
        if (SCOPE_RANK.depts > SCOPE_RANK[bestMode]) bestMode = 'depts'
      }
    } else if (scope === 4) {
      if (userDeptId) {
        for (const id of collectDeptSubtree(userDeptId, deptRows)) deptIdSet.add(id)
        if (SCOPE_RANK.depts > SCOPE_RANK[bestMode]) bestMode = 'depts'
      }
    } else if (scope === 5) {
      /* self — 仅在没有更广范围时保持 */
    }
  }

  if (bestMode === 'depts' && deptIdSet.size > 0) {
    return { mode: 'depts', deptIds: [...deptIdSet], isSuperAdmin: false }
  }

  return { mode: 'self', deptIds: [], isSuperAdmin: false }
}

/**
 * 成员列表左侧选部门：该节点及所有子孙部门 id；depts 模式与操作者数据范围取交集
 * @param {number} deptId
 * @param {{ mode: string, deptIds: number[] }} scope
 */
function userListDeptFilterIds(deptId, scope) {
  const did = Number(deptId) || 0
  if (!did) return []
  const deptRows = allDepartments()
  let ids = collectDeptSubtree(did, deptRows)
  if (scope.mode === 'depts' && scope.deptIds.length) {
    const allow = new Set(scope.deptIds)
    ids = ids.filter((id) => allow.has(id))
  }
  return ids
}

/**
 * 部门列表可见 id（含祖先，便于树展示）
 */
function visibleDeptIdsForUser(userId) {
  const scope = resolveDataScope(userId)
  if (scope.mode === 'all') return null
  if (scope.mode === 'self') return []
  const deptRows = allDepartments()
  return expandDeptIdsWithAncestors(scope.deptIds, deptRows)
}

/**
 * @returns {{ sql: string, params: unknown[] }}
 */
function userListScopeClause(userId, alias = 'u') {
  const scope = resolveDataScope(userId)
  const parts = []
  const params = []

  parts.push(`${alias}.id != ?`)
  params.push(BUILTIN_ADMIN_USER_ID)

  if (scope.mode === 'self') {
    parts.push(`${alias}.id = ?`)
    params.push(Number(userId))
  } else if (scope.mode === 'depts' && scope.deptIds.length) {
    const ph = scope.deptIds.map(() => '?').join(',')
    parts.push(`${alias}.dept_id IN (${ph})`)
    params.push(...scope.deptIds)
  } else if (scope.mode === 'depts' && !scope.deptIds.length) {
    parts.push('1=0')
  }

  const sql = parts.length ? parts.join(' AND ') : '1=1'
  return { sql, params, scope }
}

function assertDeptInScope(operatorId, deptId) {
  const scope = resolveDataScope(operatorId)
  const did = Number(deptId) || 0
  if (scope.mode === 'all') return { ok: true }
  if (scope.mode === 'self') {
    return { ok: false, msg: '无权操作该部门' }
  }
  if (!did || !scope.deptIds.includes(did)) {
    return { ok: false, msg: '无权操作该部门' }
  }
  return { ok: true }
}

function assertUserInScope(operatorId, targetUserId) {
  const tid = Number(targetUserId)
  if (!tid) return { ok: false, msg: '用户不存在' }
  if (tid === BUILTIN_ADMIN_USER_ID && !isSuperAdmin(operatorId)) {
    return { ok: false, msg: '无权操作该用户' }
  }
  const scope = resolveDataScope(operatorId)
  if (scope.mode === 'all') return { ok: true }
  if (scope.mode === 'self') {
    if (tid === Number(operatorId)) return { ok: true }
    return { ok: false, msg: '无权操作该用户' }
  }
  const target = getDb().prepare('SELECT dept_id FROM users WHERE id = ?').get(tid)
  if (!target) return { ok: false, msg: '用户不存在' }
  const deptId = Number(target.dept_id) || 0
  if (!deptId || !scope.deptIds.includes(deptId)) {
    return { ok: false, msg: '无权操作该用户' }
  }
  return { ok: true }
}

function assertCanAssignRoles(operatorId, roleIds) {
  const ids = (roleIds || []).map((x) => Number(x)).filter((x) => x > 0)
  if (!isSuperAdmin(operatorId) && ids.includes(SUPER_ADMIN_ROLE_ID)) {
    return { ok: false, msg: '无权分配超级管理员角色' }
  }
  return { ok: true }
}

function assertCanManageDepts(operatorId) {
  if (!isSuperAdmin(operatorId)) {
    return { ok: false, msg: '仅超级管理员可维护组织架构' }
  }
  return { ok: true }
}

/**
 * 创作日志 jobs 表别名 j，用户表 u
 */
function videoJobsScopeClause(userId) {
  const scope = resolveDataScope(userId)
  const parts = []
  const params = []

  if (scope.mode === 'self') {
    parts.push('j.user_id = ?')
    params.push(Number(userId))
  } else if (scope.mode === 'depts' && scope.deptIds.length) {
    const ph = scope.deptIds.map(() => '?').join(',')
    parts.push(`u.dept_id IN (${ph})`)
    params.push(...scope.deptIds)
  } else if (scope.mode === 'depts' && !scope.deptIds.length) {
    parts.push('1=0')
  }

  const sql = parts.length ? parts.join(' AND ') : ''
  return { sql, params, scope }
}

module.exports = {
  SUPER_ADMIN_ROLE_ID,
  BUILTIN_ADMIN_USER_ID,
  isSuperAdmin,
  resolveDataScope,
  userListDeptFilterIds,
  visibleDeptIdsForUser,
  userListScopeClause,
  assertDeptInScope,
  assertUserInScope,
  assertCanAssignRoles,
  assertCanManageDepts,
  videoJobsScopeClause,
  expandDeptIdsWithAncestors,
}
