const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const Database = require('better-sqlite3')

function hashPassword(password) {
  return crypto.createHash('sha256').update(`wan-ai:${password}`, 'utf8').digest('hex')
}

let dbInstance = null

function getDataDir() {
  const dir = process.env.DATA_DIR || path.join(__dirname, 'data')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getDbPath() {
  return path.join(getDataDir(), 'wan-ai.db')
}

function ensureColumn(db, table, column, defSql) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${defSql}`)
  }
}

/** 热升级：已运行的进程拉新代码后，仍会在首次 getDb() 时补上缺失表 */
function applySchemaPatches(dbi) {
  if (!dbi) return
  try {
    dbi.exec(`
      CREATE TABLE IF NOT EXISTS user_quick_entries (
        user_id INTEGER NOT NULL,
        menu_id INTEGER NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, menu_id)
      );
    `)
  } catch (e) {
    console.error('[db] applySchemaPatches failed', e.message)
  }
}

function initDb() {
  if (dbInstance) return dbInstance

  const dbPath = getDbPath()
  dbInstance = new Database(dbPath)
  dbInstance.pragma('journal_mode = WAL')

  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT,
      avatar TEXT,
      dept_id INTEGER DEFAULT 0,
      status INTEGER DEFAULT 0,
      mobile TEXT,
      email TEXT,
      sex INTEGER DEFAULT 0,
      remark TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER DEFAULT 0,
      name TEXT NOT NULL,
      sort INTEGER DEFAULT 0,
      leader_user_id INTEGER,
      phone TEXT,
      email TEXT,
      status INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      sort INTEGER DEFAULT 0,
      status INTEGER DEFAULT 0,
      type INTEGER DEFAULT 2,
      remark TEXT,
      data_scope INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS menus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER DEFAULT 0,
      type INTEGER DEFAULT 1,
      name TEXT NOT NULL,
      path TEXT,
      component_name TEXT,
      icon TEXT,
      sort INTEGER DEFAULT 0,
      permission TEXT,
      status INTEGER DEFAULT 0,
      visible INTEGER DEFAULT 1,
      keep_alive INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS role_menus (
      role_id INTEGER NOT NULL,
      menu_id INTEGER NOT NULL,
      PRIMARY KEY (role_id, menu_id)
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INTEGER NOT NULL,
      role_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS role_data_scope_depts (
      role_id INTEGER NOT NULL,
      dept_id INTEGER NOT NULL,
      PRIMARY KEY (role_id, dept_id)
    );
  `)

  applySchemaPatches(dbInstance)

  // 老库迁移
  ensureColumn(dbInstance, 'users', 'dept_id', 'INTEGER DEFAULT 0')
  ensureColumn(dbInstance, 'users', 'status', 'INTEGER DEFAULT 0')
  ensureColumn(dbInstance, 'users', 'mobile', 'TEXT')
  ensureColumn(dbInstance, 'users', 'email', 'TEXT')
  ensureColumn(dbInstance, 'users', 'sex', 'INTEGER DEFAULT 0')
  ensureColumn(dbInstance, 'users', 'remark', 'TEXT')

  const defaultUser = process.env.ADMIN_USERNAME || 'admin'
  const defaultPass = process.env.ADMIN_PASSWORD || 'admin123'

  const hasDept = dbInstance.prepare('SELECT COUNT(*) as c FROM departments').get().c
  if (!hasDept) {
    dbInstance
      .prepare(
        'INSERT INTO departments (id, parent_id, name, sort, status) VALUES (1, 0, ?, 1, 0)'
      )
      .run('万相中台')
    dbInstance.prepare("UPDATE sqlite_sequence SET seq = 1 WHERE name = 'departments'").run()
  }

  const hasRole = dbInstance.prepare('SELECT COUNT(*) as c FROM roles').get().c
  if (!hasRole) {
    dbInstance
      .prepare(
        `INSERT INTO roles (id, name, code, sort, status, type, remark, data_scope)
         VALUES (1, '超级管理员', 'super_admin', 1, 0, 1, '内置', 1)`
      )
      .run()
    dbInstance.prepare("UPDATE sqlite_sequence SET seq = 1 WHERE name = 'roles'").run()
  }

  const hasMenu = dbInstance.prepare('SELECT COUNT(*) as c FROM menus').get().c
  if (!hasMenu) {
    const stmt = dbInstance.prepare(`
      INSERT INTO menus (id, parent_id, type, name, path, component_name, icon, sort, permission, status, visible, keep_alive)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(1, 0, 1, '系统管理', '/manage', '', 'Setting', 1, '', 0, 1, 0)
    stmt.run(2, 1, 2, '菜单管理', 'permission/menu', 'managePermissionMenu', 'Menu', 1, 'system:menu:list', 0, 1, 0)
    stmt.run(3, 1, 2, '角色管理', 'permission/role', 'managePermissionRole', 'UserFilled', 2, 'system:role:list', 0, 1, 0)
    stmt.run(4, 1, 2, '成员管理', 'permission/member', 'managePermissionMember', 'Postcard', 3, 'system:user:list', 0, 1, 0)
    dbInstance.prepare("UPDATE sqlite_sequence SET seq = 4 WHERE name = 'menus'").run()

    const mids = [1, 2, 3, 4]
    const ir = dbInstance.prepare('INSERT OR IGNORE INTO role_menus (role_id, menu_id) VALUES (?, ?)')
    for (const mid of mids) ir.run(1, mid)
  }

  let admin = dbInstance.prepare('SELECT id FROM users WHERE username = ?').get(defaultUser)
  if (!admin) {
    const info = dbInstance
      .prepare(
        'INSERT INTO users (username, password_hash, nickname, dept_id, status, mobile, email) VALUES (?, ?, ?, 1, 0, ?, ?)'
      )
      .run(defaultUser, hashPassword(defaultPass), '管理员', '', '')
    admin = { id: info.lastInsertRowid }
  } else {
    dbInstance.prepare('UPDATE users SET dept_id = COALESCE(NULLIF(dept_id, 0), 1) WHERE id = ?').run(admin.id)
  }

  dbInstance.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 1)').run(admin.id)

  for (const t of ['menus', 'departments', 'roles', 'users']) {
    try {
      const row = dbInstance.prepare(`SELECT MAX(id) as x FROM ${t}`).get()
      const m = row && row.x != null ? row.x : 0
      if (m > 0) {
        dbInstance.prepare('INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(t, m)
      }
    } catch (e) {
      /* sqlite_sequence 可能尚未创建 */
    }
  }

  return dbInstance
}

function getDb() {
  if (!dbInstance) initDb()
  else applySchemaPatches(dbInstance)
  return dbInstance
}

function findUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username)
}

function findUserById(id) {
  return getDb()
    .prepare(
      `SELECT u.id, u.username, u.nickname, u.avatar, u.dept_id, u.status, u.mobile, u.email, u.sex, u.remark,
              datetime(u.created_at) as create_time
       FROM users u WHERE u.id = ?`
    )
    .get(id)
}

function updateUserAvatar(id, avatar) {
  const r = getDb().prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, id)
  return r.changes > 0
}

function rowToUser(r) {
  if (!r) return null
  return {
    id: r.id,
    username: r.username,
    nickname: r.nickname || '',
    avatar: r.avatar || '',
    deptId: r.dept_id ?? 0,
    status: r.status ?? 0,
    mobile: r.mobile || '',
    email: r.email || '',
    sex: r.sex ?? 0,
    remark: r.remark || '',
    createTime: r.create_time ? String(r.create_time).replace('T', ' ').slice(0, 19) : '',
  }
}

function rowToMenu(r) {
  if (!r) return null
  return {
    id: r.id,
    parentId: r.parent_id,
    type: r.type,
    name: r.name,
    path: r.path || '',
    componentName: r.component_name || '',
    icon: r.icon || '',
    sort: r.sort ?? 0,
    permission: r.permission || '',
    status: r.status ?? 0,
    visible: r.visible === 1,
    keepAlive: r.keep_alive === 1,
  }
}

function rowToDept(r) {
  if (!r) return null
  return {
    id: r.id,
    parentId: r.parent_id,
    name: r.name,
    sort: r.sort ?? 0,
    leaderUserId: r.leader_user_id,
    leaderUserName: r.leader_user_name || '',
    phone: r.phone || '',
    email: r.email || '',
    status: r.status ?? 0,
    createTime: r.create_time ? String(r.create_time).replace('T', ' ').slice(0, 19) : '',
  }
}

function roleRow(r) {
  if (!r) return null
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    sort: r.sort ?? 0,
    status: r.status ?? 0,
    type: r.type ?? 2,
    remark: r.remark || '',
    dataScope: r.data_scope ?? 1,
    createTime: r.create_time ? String(r.create_time).replace('T', ' ').slice(0, 19) : '',
  }
}

module.exports = {
  initDb,
  getDb,
  hashPassword,
  findUserByUsername,
  findUserById,
  updateUserAvatar,
  rowToUser,
  rowToMenu,
  rowToDept,
  roleRow,
}
