const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const Database = require('better-sqlite3')
const {
  purgeModelCatalogSeed,
  normalizeModelCatalogVendors,
  normalizeModelCatalogDisplayNames,
  normalizeModelCatalogCapabilities,
  normalizeModelCatalogSyncMeta,
  normalizeVideoModelsModality,
  normalizeModelCatalogApiProfiles,
  normalizeModelCatalogApiProviders,
} = require('./services/modelCatalogService')

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
      CREATE TABLE IF NOT EXISTS ai_prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        scene TEXT,
        content TEXT NOT NULL,
        sort INTEGER DEFAULT 0,
        status INTEGER DEFAULT 0,
        remark TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT
      );
    `)
    ensureAiPromptMenus(dbi)
    ensureVideoSchema(dbi)
    ensureVideoMenus(dbi)
    ensureAiStudioPatch(dbi)
    ensureVideoChatSchema(dbi)
    ensureVideoChatMenu(dbi)
    ensureTextChatSchema(dbi)
    ensureTextChatMenu(dbi)
    ensureAiVideoManageMenu(dbi)
    ensureProductLibrarySchema(dbi)
    ensureProductLibraryMenu(dbi)
    ensureDouyinParseSchema(dbi)
    ensureAppSettingsSchema(dbi)
    ensureDouyinParseMenu(dbi)
    ensureAiVideoModelMenuInSidebar(dbi)
    ensureModelCatalogSchema(dbi)
    ensureModelCatalogMenu(dbi)
    ensureAuthSessionsSchema(dbi)
    ensureWorkflowMenuSync(dbi)
    seedVideoModelsIfEmpty(dbi)
    purgeModelCatalogSeed(dbi)
    normalizeModelCatalogVendors(dbi)
    normalizeModelCatalogDisplayNames(dbi)
    normalizeModelCatalogCapabilities(dbi)
    normalizeModelCatalogSyncMeta(dbi)
    normalizeVideoModelsModality(dbi)
    normalizeModelCatalogApiProfiles(dbi)
    normalizeModelCatalogApiProviders(dbi)
    ensureModelMenuOrder(dbi)
    dedupeMenusByComponentName(dbi)
    ensureSuperAdminAllMenuIds(dbi)
  } catch (e) {
    console.error('[db] applySchemaPatches failed', e.message)
  }
}

/** 旧库升级：补「AI 应用 / 提示词管理」菜单并授权给超级管理员（空库由下方 seed 写入，此处跳过） */
function ensureAiPromptMenus(dbi) {
  const hit = dbi.prepare('SELECT 1 FROM menus WHERE component_name = ? LIMIT 1').get('aiPromptManage')
  if (hit) return
  const menuCount = dbi.prepare('SELECT COUNT(*) AS c FROM menus').get().c
  if (!menuCount) return
  const maxRow = dbi.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM menus').get()
  const parentId = maxRow.m + 1
  const childId = maxRow.m + 2
  const ins = dbi.prepare(`
    INSERT INTO menus (id, parent_id, type, name, path, component_name, icon, sort, permission, status, visible, keep_alive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  ins.run(parentId, 0, 1, 'AI 应用', '/ai', '', 'Cpu', 5, '', 0, 1, 0)
  ins.run(childId, parentId, 2, '提示词管理', 'prompts', 'aiPromptManage', 'Document', 1, 'ai:prompt:list', 0, 1, 0)
  const ir = dbi.prepare('INSERT OR IGNORE INTO role_menus (role_id, menu_id) VALUES (?, ?)')
  ir.run(1, parentId)
  ir.run(1, childId)
  try {
    dbi.prepare('INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES (?, ?)').run('menus', childId)
  } catch (_) {
    /* ignore */
  }
}

/** 视频模型、方舟任务记录；热升级补表 */
function ensureVideoSchema(dbi) {
  dbi.exec(`
    CREATE TABLE IF NOT EXISTS video_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      api_model_id TEXT NOT NULL,
      sort INTEGER DEFAULT 0,
      status INTEGER DEFAULT 0,
      is_default INTEGER DEFAULT 0,
      remark TEXT,
      default_params TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );
  `)
  const tj = dbi.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='video_jobs'").get()
  const bad = tj && String(tj.sql || '').includes('PRIMARY PRIMARY')
  if (bad) {
    dbi.exec('DROP TABLE IF EXISTS video_jobs')
  }
  dbi.exec(`
    CREATE TABLE IF NOT EXISTS video_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      video_model_id INTEGER NOT NULL,
      external_task_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      prompt TEXT NOT NULL,
      request_payload TEXT,
      result_url TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      FOREIGN KEY (video_model_id) REFERENCES video_models(id)
    );
    CREATE INDEX IF NOT EXISTS idx_video_jobs_user ON video_jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_video_jobs_external ON video_jobs(external_task_id);
  `)
  /** 能力开关：是否在对话/画布中允许「参考视频」；由后台视频模型配置维护 */
  ensureColumn(dbi, 'video_models', 'supports_reference_video', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(dbi, 'video_models', 'catalog_id', 'INTEGER')
  ensureColumn(dbi, 'video_models', 'modality', "TEXT NOT NULL DEFAULT 'video'")
  ensureColumn(dbi, 'video_models', 'tags', 'TEXT')
  ensureColumn(dbi, 'video_models', 'api_profile', 'TEXT')
  ensureColumn(dbi, 'video_models', 'api_provider', 'TEXT')
  ensureColumn(dbi, 'video_jobs', 'api_profile', 'TEXT')
  ensureColumn(dbi, 'video_jobs', 'api_provider', 'TEXT')
  ensureColumn(dbi, 'video_jobs', 'usage_input_tokens', 'INTEGER')
  ensureColumn(dbi, 'video_jobs', 'usage_output_tokens', 'INTEGER')
  ensureColumn(dbi, 'video_jobs', 'cost_yuan', 'REAL')
}

/** 模型目录：DMXAPI 同步 / 手动维护的候选模型库 */
function ensureModelCatalogSchema(dbi) {
  dbi.exec(`
    CREATE TABLE IF NOT EXISTS model_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_model_id TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      modality TEXT NOT NULL DEFAULT 'unknown',
      vendor TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      status INTEGER NOT NULL DEFAULT 0,
      tags TEXT,
      capabilities_json TEXT,
      default_params TEXT,
      remark TEXT,
      raw_meta_json TEXT,
      synced_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_model_catalog_modality ON model_catalog(modality);
    CREATE INDEX IF NOT EXISTS idx_model_catalog_status ON model_catalog(status);
  `)
  ensureColumn(dbi, 'model_catalog', 'dmxapi_price_text', 'TEXT')
  ensureColumn(dbi, 'model_catalog', 'dmxapi_price_json', 'TEXT')
  ensureColumn(dbi, 'model_catalog', 'api_profile', 'TEXT')
  ensureColumn(dbi, 'model_catalog', 'api_provider', 'TEXT')
}

/** 视频创作 Hub：项目表 + 任务字段；幂等 */
function ensureStudioSchema(dbi) {
  dbi.exec(`
    CREATE TABLE IF NOT EXISTS video_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '未命名项目',
      graph_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_video_projects_user ON video_projects(user_id);
  `)
  ensureColumn(dbi, 'video_jobs', 'project_id', 'INTEGER')
  ensureColumn(dbi, 'video_jobs', 'mode', "TEXT DEFAULT 'text'")
  ensureColumn(dbi, 'video_jobs', 'source_image_url', 'TEXT')
  ensureColumn(dbi, 'video_jobs', 'source_video_urls', 'TEXT')
}

/** 对话式视频创作：会话与消息 */
function ensureVideoChatSchema(dbi) {
  dbi.exec(`
    CREATE TABLE IF NOT EXISTS video_chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '新对话',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_vchat_sess_user ON video_chat_sessions(user_id);
    CREATE TABLE IF NOT EXISTS video_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      attachments_json TEXT,
      video_job_id INTEGER,
      status TEXT,
      result_url TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES video_chat_sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_vchat_msg_session ON video_chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_vchat_msg_user ON video_chat_messages(user_id);
    CREATE INDEX IF NOT EXISTS idx_vchat_msg_job ON video_chat_messages(video_job_id);
  `)
  /** 助手消息：当时的视频模型展示名（快照）；历史数据可由 JOIN video_jobs 回填 */
  ensureColumn(dbi, 'video_chat_messages', 'video_model_name', 'TEXT')
}

/** 对话创作（文本/图片多模态 LLM 会话） */
function ensureTextChatSchema(dbi) {
  dbi.exec(`
    CREATE TABLE IF NOT EXISTS text_chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '新对话',
      model_id INTEGER,
      summary TEXT NOT NULL DEFAULT '',
      summary_updated_at TEXT,
      context_budget_tokens INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tchat_sess_user ON text_chat_sessions(user_id);
    CREATE TABLE IF NOT EXISTS text_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      attachments_json TEXT,
      token_estimate INTEGER NOT NULL DEFAULT 0,
      included_in_summary INTEGER NOT NULL DEFAULT 0,
      model_name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES text_chat_sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_tchat_msg_session ON text_chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_tchat_msg_user ON text_chat_messages(user_id);
  `)
  ensureColumn(dbi, 'text_chat_sessions', 'image_model_id', 'INTEGER')
  ensureColumn(dbi, 'text_chat_messages', 'generation_mode', "TEXT DEFAULT 'reply'")
  ensureColumn(dbi, 'text_chat_messages', 'status', 'TEXT')
  ensureColumn(dbi, 'text_chat_messages', 'result_urls_json', 'TEXT')
  ensureColumn(dbi, 'text_chat_messages', 'error_message', 'TEXT')
}

/** 登录会话持久化（access / refresh），进程重启后仍有效 */
function ensureAuthSessionsSchema(dbi) {
  dbi.exec(`
    CREATE TABLE IF NOT EXISTS auth_access_tokens (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      exp_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_access_user ON auth_access_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_access_exp ON auth_access_tokens(exp_ms);
    CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      exp_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_refresh_user ON auth_refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_refresh_exp ON auth_refresh_tokens(exp_ms);
  `)
}

/** 工作流（Studio）：仅校正 path，不改菜单名称（名称由菜单管理维护）。 */
function ensureWorkflowMenuSync(dbi) {
  try {
    dbi.prepare(`UPDATE menus SET path = 'studio' WHERE component_name = 'aiVideoStudio'`).run()
  } catch (e) {
    console.error('[db] ensureWorkflowMenuSync', e.message)
  }
}

function ensureVideoChatMenu(dbi) {
  if (dbi.prepare('SELECT 1 FROM menus WHERE component_name = ? LIMIT 1').get('aiVideoChat')) return
  const aiRow = dbi.prepare(`SELECT id FROM menus WHERE parent_id = 0 AND path = '/ai' LIMIT 1`).get()
  if (!aiRow) return
  const parentId = aiRow.id
  const maxRow = dbi.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM menus').get()
  const id = maxRow.m + 1
  const ins = dbi.prepare(`
    INSERT INTO menus (id, parent_id, type, name, path, component_name, icon, sort, permission, status, visible, keep_alive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  ins.run(id, parentId, 2, '视频生成', 'video-chat', 'aiVideoChat', 'VideoCamera', 2, 'ai:canvas:access', 0, 1, 0)
  dbi.prepare(`UPDATE menus SET sort = 3 WHERE component_name = 'aiPromptManage' AND parent_id = ?`).run(parentId)
  const ir = dbi.prepare('INSERT OR IGNORE INTO role_menus (role_id, menu_id) VALUES (?, ?)')
  ir.run(1, id)
  try {
    dbi.prepare('INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES (?, ?)').run('menus', id)
  } catch (_) {
    /* ignore */
  }
}

/** AI 应用 · 对话创作（文本/图片 LLM 多轮对话） */
function ensureTextChatMenu(dbi) {
  if (dbi.prepare('SELECT 1 FROM menus WHERE component_name = ? LIMIT 1').get('aiTextChat')) return
  const videoRow = dbi
    .prepare(`SELECT id, parent_id, sort FROM menus WHERE component_name = 'aiVideoChat' LIMIT 1`)
    .get()
  if (!videoRow) return
  const parentId = videoRow.parent_id
  const targetSort = (videoRow.sort ?? 2) + 1
  dbi
    .prepare(
      `UPDATE menus SET sort = sort + 1 WHERE parent_id = ? AND sort >= ? AND component_name != 'aiTextChat'`,
    )
    .run(parentId, targetSort)
  const maxRow = dbi.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM menus').get()
  const id = maxRow.m + 1
  const ins = dbi.prepare(`
    INSERT INTO menus (id, parent_id, type, name, path, component_name, icon, sort, permission, status, visible, keep_alive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  ins.run(
    id,
    parentId,
    2,
    '对话创作',
    'text-chat',
    'aiTextChat',
    'ChatDotRound',
    targetSort,
    'ai:text-chat:access',
    0,
    1,
    0,
  )
  const ir = dbi.prepare('INSERT OR IGNORE INTO role_menus (role_id, menu_id) VALUES (?, ?)')
  ir.run(1, id)
  try {
    dbi.prepare('INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES (?, ?)').run('menus', id)
  } catch (_) {
    /* ignore */
  }
}

/** AI 应用 · 创作日志（原「视频管理」）：跨用户查看生成任务（权限 ai:video-manage:list） */
function ensureAiVideoManageMenu(dbi) {
  if (dbi.prepare('SELECT 1 FROM menus WHERE component_name = ? LIMIT 1').get('aiVideoManage')) return
  const aiRow = dbi.prepare(`SELECT id FROM menus WHERE parent_id = 0 AND path = '/ai' LIMIT 1`).get()
  if (!aiRow) return
  const parentId = aiRow.id
  const maxRow = dbi.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM menus').get()
  const id = maxRow.m + 1
  const ins = dbi.prepare(`
    INSERT INTO menus (id, parent_id, type, name, path, component_name, icon, sort, permission, status, visible, keep_alive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  ins.run(id, parentId, 2, '创作日志', 'video-manage', 'aiVideoManage', 'Film', 4, 'ai:video-manage:list', 0, 1, 0)
  const ir = dbi.prepare('INSERT OR IGNORE INTO role_menus (role_id, menu_id) VALUES (?, ?)')
  ir.run(1, id)
  try {
    dbi.prepare('INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES (?, ?)').run('menus', id)
  } catch (_) {
    /* ignore */
  }
}

/** 抖音解析：粘贴分享链接/文案，后端解析原链接素材后落库的记录表 */
function ensureDouyinParseSchema(dbi) {
  dbi.exec(`
    CREATE TABLE IF NOT EXISTS douyin_parse_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      input_text TEXT,
      douyin_url TEXT,
      aweme_id TEXT,
      title TEXT,
      author TEXT,
      cover TEXT,
      media_type TEXT NOT NULL DEFAULT 'video',
      is_video INTEGER NOT NULL DEFAULT 1,
      result_url TEXT,
      images TEXT,
      source TEXT NOT NULL DEFAULT 'aggregator',
      status TEXT NOT NULL DEFAULT 'success',
      error_message TEXT,
      duration_ms INTEGER,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_douyin_logs_user ON douyin_parse_logs(user_id);
  `)
}

/** 全局键值配置（如抖音聚合方式）；缺省键用 INSERT OR IGNORE 种子，不覆盖已入库值 */
function ensureAppSettingsSchema(dbi) {
  dbi.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `)
  const envSide = String(process.env.DOUYIN_AGG_SIDE || 'server').trim().toLowerCase()
  const seedSide = envSide === 'browser' || envSide === 'client' ? 'browser' : 'server'
  dbi
    .prepare(
      `INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
    )
    .run('douyin.agg_side', seedSide)
}

function getAppSetting(key, fallback = '') {
  try {
    const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(String(key || ''))
    return row != null ? String(row.value ?? '') : fallback
  } catch (_) {
    return fallback
  }
}

function setAppSetting(key, value) {
  const k = String(key || '').trim()
  if (!k) throw new Error('setting key required')
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .run(k, String(value ?? ''))
}

/** 顶级「AI工具」目录：与「AI 应用」并列，收纳工具/素材类功能。返回其 id */
function ensureToolsMenu(dbi) {
  const existing = dbi.prepare(`SELECT id FROM menus WHERE parent_id = 0 AND path = '/tools' LIMIT 1`).get()
  if (existing) return existing.id
  const maxRow = dbi.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM menus').get()
  const id = maxRow.m + 1
  dbi
    .prepare(`
      INSERT INTO menus (id, parent_id, type, name, path, component_name, icon, sort, permission, status, visible, keep_alive)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(id, 0, 1, 'AI工具', '/tools', '', 'Sunset', 6, '', 0, 1, 0)
  dbi.prepare('INSERT OR IGNORE INTO role_menus (role_id, menu_id) VALUES (?, ?)').run(1, id)
  try {
    dbi.prepare('INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES (?, ?)').run('menus', id)
  } catch (_) {
    /* ignore */
  }
  return id
}

/** AI工具 · 抖音素材提取：粘贴抖音链接提取原链接素材（权限 tools:douyin-parse:list） */
function ensureDouyinParseMenu(dbi) {
  const toolsId = ensureToolsMenu(dbi)
  if (!toolsId) return
  // 兼容旧版：曾以 aiDouyinParse 挂在「AI 应用」下，这里统一迁移到工具箱并改名/换权限
  const row = dbi
    .prepare(`SELECT id, component_name, parent_id, permission FROM menus WHERE component_name IN ('aiDouyinParse', 'toolsDouyinParse') LIMIT 1`)
    .get()
  if (row) {
    if (row.component_name === 'aiDouyinParse') {
      // 仅旧版做一次性结构迁移（含名称/图标默认值）。
      dbi
        .prepare(`
          UPDATE menus SET parent_id = ?, type = 2, name = '抖音素材提取', path = 'douyin-parse',
            component_name = 'toolsDouyinParse', icon = 'VideoCamera', sort = 1,
            permission = 'tools:douyin-parse:list', status = 0, visible = 1
          WHERE id = ?
        `)
        .run(toolsId, row.id)
    } else if (row.parent_id !== toolsId || row.permission !== 'tools:douyin-parse:list') {
      // 已是新版：仅兜底修正必须与代码一致的结构字段（父级/权限/组件名/路由）。
      // 不覆盖用户可自定义的展示字段（图标/名称/排序/显隐），避免每次启动重置用户在菜单管理里的修改。
      dbi
        .prepare(`
          UPDATE menus SET parent_id = ?, type = 2, component_name = 'toolsDouyinParse',
            path = 'douyin-parse', permission = 'tools:douyin-parse:list', status = 0
          WHERE id = ?
        `)
        .run(toolsId, row.id)
    }
    dbi.prepare('INSERT OR IGNORE INTO role_menus (role_id, menu_id) VALUES (1, ?)').run(row.id)
    return
  }
  const maxRow = dbi.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM menus').get()
  const id = maxRow.m + 1
  dbi
    .prepare(`
      INSERT INTO menus (id, parent_id, type, name, path, component_name, icon, sort, permission, status, visible, keep_alive)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(id, toolsId, 2, '抖音素材提取', 'douyin-parse', 'toolsDouyinParse', 'VideoCamera', 1, 'tools:douyin-parse:list', 0, 1, 0)
  dbi.prepare('INSERT OR IGNORE INTO role_menus (role_id, menu_id) VALUES (?, ?)').run(1, id)
  try {
    dbi.prepare('INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES (?, ?)').run('menus', id)
  } catch (_) {
    /* ignore */
  }
}

/** 对话等产品图：按用户隔离的产品库条目（多图 URL 存 JSON 数组） */
function ensureProductLibrarySchema(dbi) {
  try {
    dbi.exec(`
      CREATE TABLE IF NOT EXISTS product_library_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        remark TEXT,
        image_urls TEXT NOT NULL DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_product_library_user ON product_library_items(user_id);
    `)
  } catch (e) {
    console.error('[db] ensureProductLibrarySchema', e.message)
  }
}

/** AI 应用 · 产品库：个人产品多图，排序在创作日志之上（权限 ai:product-library:list） */
function ensureProductLibraryMenu(dbi) {
  if (dbi.prepare('SELECT 1 FROM menus WHERE component_name = ? LIMIT 1').get('aiProductLibrary')) return
  const aiRow = dbi.prepare(`SELECT id FROM menus WHERE parent_id = 0 AND path = '/ai' LIMIT 1`).get()
  if (!aiRow) return
  const parentId = aiRow.id
  try {
    dbi
      .prepare(`UPDATE menus SET sort = 5 WHERE component_name = 'aiVideoManage' AND parent_id = ?`)
      .run(parentId)
  } catch (e) {
    console.error('[db] ensureProductLibraryMenu bump video-manage sort', e.message)
  }
  const maxRow = dbi.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM menus').get()
  const id = maxRow.m + 1
  const ins = dbi.prepare(`
    INSERT INTO menus (id, parent_id, type, name, path, component_name, icon, sort, permission, status, visible, keep_alive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  ins.run(id, parentId, 2, '产品库', 'product-library', 'aiProductLibrary', 'Goods', 4, 'ai:product-library:list', 0, 1, 0)
  const ir = dbi.prepare('INSERT OR IGNORE INTO role_menus (role_id, menu_id) VALUES (?, ?)')
  ir.run(1, id)
  try {
    dbi.prepare('INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES (?, ?)').run('menus', id)
  } catch (_) {
    /* ignore */
  }
}

/**
 * 侧栏展示「模型管理」（`/ai/video-models`）；历史库曾默认 visible=0。
 * 缺行时补插入并授权超级管理员。
 */
function ensureAiVideoModelMenuInSidebar(dbi) {
  try {
    const row = dbi.prepare(`SELECT id FROM menus WHERE component_name = ?`).get('aiVideoModelManage')
    if (!row) {
      const aiRow = dbi.prepare(`SELECT id FROM menus WHERE parent_id = 0 AND path = '/ai' LIMIT 1`).get()
      if (!aiRow) return
      const parentId = aiRow.id
      const maxRow = dbi.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM menus').get()
      const id = maxRow.m + 1
      const ins = dbi.prepare(`
        INSERT INTO menus (id, parent_id, type, name, path, component_name, icon, sort, permission, status, visible, keep_alive)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      ins.run(id, parentId, 2, '模型商店', 'video-models', 'aiVideoModelManage', 'VideoCamera', 99, 'ai:video-model:list', 0, 1, 0)
      dbi.prepare('INSERT OR IGNORE INTO role_menus (role_id, menu_id) VALUES (1, ?)').run(id)
      try {
        dbi.prepare('INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES (?, ?)').run('menus', id)
      } catch (_) {
        /* ignore */
      }
      return
    }
    dbi.prepare(`UPDATE menus SET visible = 1, sort = 99 WHERE component_name = 'aiVideoModelManage'`).run()
  } catch (e) {
    console.error('[db] ensureAiVideoModelMenuInSidebar', e.message)
  }
}

/** 模型商店在上、模型目录在下（sort 越小越靠前） */
function ensureModelMenuOrder(dbi) {
  try {
    dbi.prepare(`UPDATE menus SET sort = 99 WHERE component_name = 'aiVideoModelManage'`).run()
    dbi.prepare(`UPDATE menus SET sort = 100 WHERE component_name = 'aiModelCatalog'`).run()
  } catch (e) {
    console.error('[db] ensureModelMenuOrder', e.message)
  }
}

/** 侧栏「模型目录」菜单 */
function ensureModelCatalogMenu(dbi) {
  try {
    const row = dbi.prepare(`SELECT id FROM menus WHERE component_name = ?`).get('aiModelCatalog')
    if (row) {
      dbi.prepare(`UPDATE menus SET visible = 1, sort = 100 WHERE component_name = 'aiModelCatalog'`).run()
      dbi.prepare(`UPDATE menus SET sort = 99 WHERE component_name = 'aiVideoModelManage'`).run()
      return
    }
    const aiRow = dbi.prepare(`SELECT id FROM menus WHERE parent_id = 0 AND path = '/ai' LIMIT 1`).get()
    if (!aiRow) return
    const parentId = aiRow.id
    const maxRow = dbi.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM menus').get()
    const id = maxRow.m + 1
    const ins = dbi.prepare(`
      INSERT INTO menus (id, parent_id, type, name, path, component_name, icon, sort, permission, status, visible, keep_alive)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    ins.run(
      id,
      parentId,
      2,
      '模型目录',
      'model-catalog',
      'aiModelCatalog',
      'Collection',
      100,
      'ai:model-catalog:list',
      0,
      1,
      0,
    )
    dbi.prepare('INSERT OR IGNORE INTO role_menus (role_id, menu_id) VALUES (1, ?)').run(id)
    try {
      dbi.prepare('INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES (?, ?)').run('menus', id)
    } catch (_) {
      /* ignore */
    }
  } catch (e) {
    console.error('[db] ensureModelCatalogMenu', e.message)
  }
}

/**
 * 菜单收敛：创意画布 → 工作流（Studio）；隐藏无实现占位项。
 * 不在此重复覆盖 visible / sort（否则与菜单管理接口互相覆盖）。
 */
function ensureAiStudioPatch(dbi) {
  ensureStudioSchema(dbi)
  try {
    const aiRow = dbi.prepare(`SELECT id FROM menus WHERE parent_id = 0 AND path = '/ai' LIMIT 1`).get()
    const aiParentId = aiRow ? aiRow.id : null
    if (aiParentId != null) {
      const studioExists = dbi
        .prepare(
          `SELECT 1 FROM menus WHERE parent_id = ? AND component_name = 'aiVideoStudio' LIMIT 1`
        )
        .get(aiParentId)
      if (studioExists) {
        const canvasIds = dbi
          .prepare(`SELECT id FROM menus WHERE parent_id = ? AND component_name = 'aiVideoCanvas'`)
          .all(aiParentId)
          .map((r) => r.id)
        for (const cid of canvasIds) {
          dbi.prepare('DELETE FROM role_menus WHERE menu_id = ?').run(cid)
          dbi.prepare('DELETE FROM user_quick_entries WHERE menu_id = ?').run(cid)
          dbi.prepare('DELETE FROM menus WHERE id = ?').run(cid)
        }
      } else {
        dbi
          .prepare(
            `UPDATE menus SET component_name = 'aiVideoStudio', path = 'studio', icon = 'Grid'
             WHERE component_name = 'aiVideoCanvas'`
          )
          .run()
      }
    }
    /* 「模型管理」侧栏可见性由 ensureAiVideoModelMenuInSidebar 维护。 */
    dbi
      .prepare(
        `UPDATE menus SET visible = 0
         WHERE type = 2 AND name IN ('视频生成', '智能体')
           AND (component_name IS NULL OR TRIM(component_name) = '')`
      )
      .run()
    /* 不在此强制 sort：否则菜单管理里改的「显示排序」会在下一次 API 时被改回固定 1/2/3。
       默认顺序仅在 ensureVideoMenus / ensureVideoChatMenu 首次插入时写入。 */
  } catch (e) {
    console.error('[db] ensureAiStudioPatch', e.message)
  }
}

function seedVideoModelsIfEmpty(_dbi) {
  /* 模型商店改由 DMXAPI 同步 + 从目录上架，不再预置示例条目 */
}

/**
 * 合并脏数据：同一父节点下相同 component_name 的多条菜单只保留 id 最小的一条，
 * 并把 role_menus / user_quick_entries / 子菜单 parent_id 迁到保留项上。
 */
function dedupeMenusByComponentName(dbi) {
  try {
    const dups = dbi
      .prepare(
        `SELECT parent_id, component_name, MIN(id) AS keeper_id, COUNT(*) AS c
         FROM menus
         WHERE TRIM(COALESCE(component_name, '')) != ''
         GROUP BY parent_id, component_name
         HAVING c > 1`
      )
      .all()
    if (!dups.length) return
    const rmIns = dbi.prepare('INSERT OR IGNORE INTO role_menus (role_id, menu_id) VALUES (?, ?)')
    const rmDel = dbi.prepare('DELETE FROM role_menus WHERE menu_id = ?')
    const qeDel = dbi.prepare('DELETE FROM user_quick_entries WHERE menu_id = ?')
    const orphans = dbi.prepare('UPDATE menus SET parent_id = ? WHERE parent_id = ?')
    const delMenu = dbi.prepare('DELETE FROM menus WHERE id = ?')
    for (const g of dups) {
      const keeper = g.keeper_id
      const dropRows = dbi
        .prepare(
          `SELECT id FROM menus
           WHERE parent_id = ? AND component_name = ? AND id != ?`
        )
        .all(g.parent_id, g.component_name, keeper)
      for (const { id } of dropRows) {
        const roles = dbi.prepare('SELECT role_id FROM role_menus WHERE menu_id = ?').all(id)
        for (const { role_id } of roles) rmIns.run(role_id, keeper)
        rmDel.run(id)
        qeDel.run(id)
        orphans.run(keeper, id)
        delMenu.run(id)
      }
    }
    console.info('[db] dedupeMenusByComponentName: merged duplicate menu rows by (parent_id, component_name)')
  } catch (e) {
    console.error('[db] dedupeMenusByComponentName', e.message)
  }
}

/** 超级管理员（role_id=1）补齐与当前 menus 表一致的授权，避免迁移/去重后漏配 */
function ensureSuperAdminAllMenuIds(dbi) {
  try {
    const ins = dbi.prepare('INSERT OR IGNORE INTO role_menus (role_id, menu_id) VALUES (1, ?)')
    const ids = dbi.prepare('SELECT id FROM menus').all()
    for (const { id } of ids) ins.run(id)
  } catch (e) {
    console.error('[db] ensureSuperAdminAllMenuIds', e.message)
  }
}

/** 补「工作流」「模型管理」菜单并授权超级管理员 */
function ensureVideoMenus(dbi) {
  const hit = dbi
    .prepare(
      `SELECT 1 FROM menus WHERE component_name IN ('aiVideoCanvas', 'aiVideoStudio') LIMIT 1`
    )
    .get()
  if (hit) return
  const parent = dbi
    .prepare(`SELECT id FROM menus WHERE parent_id = 0 AND (path = '/ai' OR path = 'ai') LIMIT 1`)
    .get()
  const parentRow = parent || dbi.prepare(`SELECT id FROM menus WHERE name = ? AND parent_id = 0 LIMIT 1`).get('AI 应用')
  if (!parentRow) return
  const parentId = parentRow.id
  const maxRow = dbi.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM menus').get()
  const id1 = maxRow.m + 1
  const id2 = maxRow.m + 2
  const ins = dbi.prepare(`
    INSERT INTO menus (id, parent_id, type, name, path, component_name, icon, sort, permission, status, visible, keep_alive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  ins.run(id1, parentId, 2, '工作流', 'studio', 'aiVideoStudio', 'Grid', 1, 'ai:canvas:access', 0, 1, 0)
  ins.run(id2, parentId, 2, '模型商店', 'video-models', 'aiVideoModelManage', 'VideoCamera', 99, 'ai:video-model:list', 0, 1, 0)
  dbi.prepare(`UPDATE menus SET sort = 2 WHERE component_name = 'aiPromptManage' AND parent_id = ?`).run(parentId)
  const ir = dbi.prepare('INSERT OR IGNORE INTO role_menus (role_id, menu_id) VALUES (?, ?)')
  ir.run(1, id1)
  ir.run(1, id2)
  try {
    dbi.prepare('INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES (?, ?)').run('menus', id2)
  } catch (_) {
    /* ignore */
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

    CREATE TABLE IF NOT EXISTS ai_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      scene TEXT,
      content TEXT NOT NULL,
      sort INTEGER DEFAULT 0,
      status INTEGER DEFAULT 0,
      remark TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
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
    stmt.run(5, 0, 1, 'AI 应用', '/ai', '', 'Cpu', 5, '', 0, 1, 0)
    stmt.run(6, 5, 2, '提示词管理', 'prompts', 'aiPromptManage', 'Document', 1, 'ai:prompt:list', 0, 1, 0)
    dbInstance.prepare("UPDATE sqlite_sequence SET seq = 6 WHERE name = 'menus'").run()

    const mids = [1, 2, 3, 4, 5, 6]
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

  /* 菜单等种子数据写入后再跑一次补丁，保证新库也能挂上视频相关菜单 */
  applySchemaPatches(dbInstance)

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
              datetime(u.created_at, 'localtime') as create_time
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

/**
 * 启动对账：进程重启后，内存里的抖音解析后台任务已丢失，
 * 把 DB 中残留的 processing/pending 行统一判失败，避免永远卡在「解析中」。
 */
function reconcileDouyinProcessingOnBoot() {
  try {
    const dbi = getDb()
    const r = dbi
      .prepare(
        `UPDATE douyin_parse_logs
         SET status = 'failed', error_message = '服务重启，任务已中断，请重新获取', updated_at = datetime('now')
         WHERE status IN ('processing', 'pending')`,
      )
      .run()
    if (r.changes > 0) {
      console.info(`[db] 抖音解析启动对账：${r.changes} 条「解析中」任务因重启判失败`)
    }
  } catch (e) {
    console.warn('[db] reconcileDouyinProcessingOnBoot skipped:', e && e.message)
  }
}

/** 启动时清掉超过 3 天仍「生成中」的视频任务，避免对已失效远端 task 死循环拉取 */
function reconcileStaleVideoJobsOnBoot() {
  try {
    const dbi = getDb()
    const stale = dbi
      .prepare(
        `SELECT id FROM video_jobs
         WHERE status IN ('pending', 'processing')
           AND datetime(COALESCE(created_at, updated_at)) < datetime('now', '-3 days')`,
      )
      .all()
    if (!stale.length) return
    const msg = '任务已超时或远端已失效，已自动结束'
    const upd = dbi.prepare(
      `UPDATE video_jobs SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?`,
    )
    const updMsg = dbi.prepare(
      `UPDATE video_chat_messages SET status = 'failed', error_message = ?
       WHERE video_job_id = ? AND status IN ('pending', 'processing')`,
    )
    const tx = dbi.transaction((rows) => {
      for (const row of rows) {
        upd.run(msg, row.id)
        updMsg.run(msg, row.id)
      }
    })
    tx(stale)
    console.info(`[db] 视频任务启动对账：${stale.length} 条超过 3 天的「生成中」任务已判失败`)
  } catch (e) {
    console.warn('[db] reconcileStaleVideoJobsOnBoot skipped:', e && e.message)
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
  getAppSetting,
  setAppSetting,
  reconcileDouyinProcessingOnBoot,
  reconcileStaleVideoJobsOnBoot,
}
