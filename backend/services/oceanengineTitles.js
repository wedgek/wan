/**
 * 标题库：一个标题包有一个名字和一批标题。搭建时选一个包，从里面随机抽最多 30 条。
 */
const db = require('../db')

const TITLE_MIN = 5
const TITLE_MAX = 55
const PICK_LIMIT = 30
const PACK_TITLE_LIMIT = 2000

function database() {
  return db.getDb()
}

function oceanLen(text) {
  let n = 0
  for (const ch of String(text || '')) {
    n += ch.codePointAt(0) <= 0x7f ? 0.5 : 1
  }
  return Math.ceil(n)
}

function clipToOcean(text, max) {
  let out = ''
  let n = 0
  for (const ch of String(text || '')) {
    const add = ch.codePointAt(0) <= 0x7f ? 0.5 : 1
    if (n + add > max) break
    out += ch
    n += add
  }
  return out.trim().replace(/[，、：；\s]+$/g, '')
}

function normalizeTitle(raw) {
  let text = String(raw == null ? '' : raw)
    .replace(/\uFFFC|\u200B|\uFEFF|\u00A0/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
  text = text.replace(/#+\s*[\w\u4e00-\u9fff]{1,12}(?=$|[\s#])/g, ' ')
  text = text.replace(/#/g, '')
  text = text.replace(/点击阅读\s*[>＞]*/g, '')
  text = text.replace(/[>＞]{2,}/g, '')
  text = text.replace(/([^\w\u4e00-\u9fff])\1{1,}/g, '$1')
  text = text.replace(/\s+/g, ' ').trim()
  text = text.replace(/\s+([，。！？、：；])/g, '$1')
  if (oceanLen(text) > TITLE_MAX) text = clipToOcean(text, TITLE_MAX)
  if (oceanLen(text) < TITLE_MIN || oceanLen(text) > TITLE_MAX) return ''
  return text
}

function validTitle(text) {
  return normalizeTitle(text)
}

function parseTitleLines(raw) {
  const lines = String(raw == null ? '' : raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const titles = []
  const skipped = []
  const seen = new Set()
  for (const line of lines) {
    const title = validTitle(line)
    if (!title) {
      skipped.push(line)
      continue
    }
    if (seen.has(title)) continue
    seen.add(title)
    titles.push(title)
    if (titles.length >= PACK_TITLE_LIMIT) break
  }
  return { titles, skipped }
}

function shuffle(list) {
  const copy = list.slice()
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const current = copy[i]
    copy[i] = copy[j]
    copy[j] = current
  }
  return copy
}

function listGroupRows(libraryId) {
  return database()
    .prepare(`SELECT * FROM oceanengine_title_groups WHERE library_id = ? ORDER BY sort, id`)
    .all(Number(libraryId) || 0)
}

function titlesOfGroup(groupId) {
  return database()
    .prepare(`SELECT text FROM oceanengine_titles WHERE group_id = ? ORDER BY sort, id`)
    .all(Number(groupId) || 0)
    .map((row) => row.text)
    .filter(Boolean)
}

function titlesOfPack(libraryId) {
  const titles = []
  const seen = new Set()
  for (const group of listGroupRows(libraryId)) {
    for (const text of titlesOfGroup(group.id)) {
      const title = validTitle(text) || String(text || '').trim()
      if (!title || seen.has(title)) continue
      seen.add(title)
      titles.push(title)
    }
  }
  return titles
}

function mapPack(row, extra = {}) {
  const titles = Array.isArray(extra.titles) ? extra.titles : null
  const titleCount = Number(extra.titleCount != null ? extra.titleCount : titles ? titles.length : row.title_count) || 0
  return {
    id: row.id,
    name: row.name,
    remark: row.remark || '',
    titleCount,
    usable: titleCount > 0,
    usableGroups: titleCount > 0 ? 1 : 0,
    preview: extra.preview || (titles ? titles.slice(0, 3).join(' / ') : ''),
    titles: titles || [],
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  }
}

function titlesByLibrary() {
  const rows = database()
    .prepare(
      `SELECT g.library_id, t.text
       FROM oceanengine_title_groups g
       JOIN oceanengine_titles t ON t.group_id = g.id
       ORDER BY g.library_id, t.sort, t.id`,
    )
    .all()
  const map = new Map()
  for (const row of rows) {
    const list = map.get(row.library_id) || []
    const title = String(row.text || '').trim()
    if (!title || list.includes(title)) continue
    list.push(title)
    map.set(row.library_id, list)
  }
  return map
}

function listLibraries() {
  const rows = database()
    .prepare(`SELECT * FROM oceanengine_title_libraries ORDER BY id DESC`)
    .all()
  const byLib = titlesByLibrary()
  return rows.map((row) => {
    const titles = byLib.get(row.id) || []
    return mapPack(row, { titles, titleCount: titles.length, preview: titles.slice(0, 3).join(' / ') })
  })
}

function getLibrary(id) {
  const libraryId = Number(id) || 0
  const row = database().prepare(`SELECT * FROM oceanengine_title_libraries WHERE id = ?`).get(libraryId)
  if (!row) return null
  const titles = titlesOfPack(libraryId)
  return mapPack(row, { titles, titleCount: titles.length, preview: titles.slice(0, 3).join(' / ') })
}

function savePackTitles(libraryId, titles, packName) {
  const groups = listGroupRows(libraryId)
  const wipe = database().prepare(`DELETE FROM oceanengine_titles WHERE group_id = ?`)
  for (const group of groups) wipe.run(group.id)
  database().prepare(`DELETE FROM oceanengine_title_groups WHERE library_id = ?`).run(libraryId)
  const inserted = database()
    .prepare(
      `INSERT INTO oceanengine_title_groups (library_id, name, sort, created_at, updated_at)
       VALUES (?, ?, 1, datetime('now'), datetime('now'))`,
    )
    .run(libraryId, packName || '标题')
  const insert = database().prepare(`INSERT INTO oceanengine_titles (group_id, text, sort, created_at) VALUES (?, ?, ?, datetime('now'))`)
  titles.forEach((text, index) => insert.run(inserted.lastInsertRowid, text, index + 1))
}

function createLibrary(input) {
  const name = String((input && input.name) || '').trim().slice(0, 40)
  if (!name) return { error: '请填写标题包名称' }
  const remark = String((input && input.remark) || '').trim().slice(0, 80)
  const dup = database().prepare(`SELECT id FROM oceanengine_title_libraries WHERE name = ?`).get(name)
  if (dup) return { error: '已有同名标题包' }
  const parsed = parseTitleLines((input && (input.titlesText || input.titles)) || '')
  if (!parsed.titles.length) return { error: '请至少写一条 5 到 55 个字的标题' }
  const inserted = database()
    .prepare(`INSERT INTO oceanengine_title_libraries (name, remark, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`)
    .run(name, remark)
  savePackTitles(inserted.lastInsertRowid, parsed.titles, name)
  const pack = getLibrary(inserted.lastInsertRowid)
  return { ...pack, skipped: parsed.skipped.length }
}

function updateLibrary(id, input) {
  const current = getLibrary(id)
  if (!current) return { error: '没有这个标题包' }
  const name = String((input && input.name) != null ? input.name : current.name).trim().slice(0, 40)
  if (!name) return { error: '请填写标题包名称' }
  const remark = String((input && input.remark) != null ? input.remark : current.remark).trim().slice(0, 80)
  const dup = database().prepare(`SELECT id FROM oceanengine_title_libraries WHERE name = ? AND id != ?`).get(name, current.id)
  if (dup) return { error: '已有同名标题包' }
  const hasTitles = input && (input.titlesText != null || input.titles != null)
  const parsed = hasTitles
    ? parseTitleLines(input.titlesText != null ? input.titlesText : input.titles)
    : { titles: current.titles, skipped: [] }
  if (!parsed.titles.length) return { error: '请至少写一条 5 到 55 个字的标题' }
  database()
    .prepare(`UPDATE oceanengine_title_libraries SET name = ?, remark = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(name, remark, current.id)
  savePackTitles(current.id, parsed.titles, name)
  const pack = getLibrary(current.id)
  return { ...pack, skipped: parsed.skipped.length }
}

function removeLibrary(id) {
  const current = getLibrary(id)
  if (!current) return { error: '没有这个标题包' }
  const groups = listGroupRows(current.id)
  const wipe = database().prepare(`DELETE FROM oceanengine_titles WHERE group_id = ?`)
  for (const group of groups) wipe.run(group.id)
  database().prepare(`DELETE FROM oceanengine_title_groups WHERE library_id = ?`).run(current.id)
  database().prepare(`DELETE FROM oceanengine_title_libraries WHERE id = ?`).run(current.id)
  return { id: current.id }
}

function listGroups(libraryId) {
  const library = getLibrary(libraryId)
  if (!library) return { error: '没有这个标题包' }
  return {
    library,
    groups: [{
      id: library.id,
      libraryId: library.id,
      name: library.name,
      titles: library.titles,
      titleCount: library.titleCount,
      preview: library.preview,
      createdAt: library.createdAt,
      updatedAt: library.updatedAt,
    }],
  }
}

function pickFromLibrary(libraryId) {
  const library = getLibrary(libraryId)
  if (!library) return { error: '请选择标题包' }
  const pool = library.titles.map(validTitle).filter(Boolean)
  if (!pool.length) return { error: '这个标题包里没有可用标题' }
  const titles = shuffle(pool).slice(0, PICK_LIMIT)
  return {
    libraryId: library.id,
    libraryName: library.name,
    groupName: library.name,
    titles,
  }
}

module.exports = {
  TITLE_MIN,
  TITLE_MAX,
  PICK_LIMIT,
  oceanLen,
  normalizeTitle,
  validTitle,
  parseTitleLines,
  listLibraries,
  getLibrary,
  listGroups,
  createLibrary,
  updateLibrary,
  removeLibrary,
  pickFromLibrary,
}
