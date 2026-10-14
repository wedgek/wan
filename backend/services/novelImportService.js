/**
 * 小说投流导入：解析云帆导出的 JSON / CSV / xlsx，写入书籍、素材与效果快照。
 * 列名按截图常见中文表头做别名映射；同一统计日同一时段重复导入更新快照。
 * 推广链接按表格「一行一条」导入，名称、链接、所属书籍是主字段。
 */

const zlib = require('zlib')

const BOOK_HOT_TOP_N = Number(process.env.NOVEL_BOOK_HOT_TOP_N) || 20
const BOOK_HOT_AMOUNT = Number(process.env.NOVEL_BOOK_HOT_AMOUNT) || 500
const MATERIAL_HOT_ROI = Number(process.env.NOVEL_MATERIAL_HOT_ROI) || 1
const MATERIAL_HOT_AMOUNT = Number(process.env.NOVEL_MATERIAL_HOT_AMOUNT) || 50
const MATERIAL_HOT_HEAT_TOP_N = Number(process.env.NOVEL_MATERIAL_HOT_HEAT_TOP_N) || 20

const TYPE_BOOKS = 'books'
const TYPE_LIBRARY = 'library'
const TYPE_MATERIALS = 'materials'
const TYPE_PROMO = 'promo'
const TYPE_PACK = 'pack'

const IMPORT_TYPES = [TYPE_BOOKS, TYPE_LIBRARY, TYPE_MATERIALS, TYPE_PROMO, TYPE_PACK]

const SLOT_MORNING = 'morning'
const SLOT_AFTERNOON = 'afternoon'

function inferSlot(date = new Date()) {
  return date.getHours() < 14 ? SLOT_MORNING : SLOT_AFTERNOON
}

function todayLocal(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function normalizeKey(k) {
  return String(k || '')
    .trim()
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[\s_\-./:：()（）[\]]+/g, '')
}

function parseNumber(raw) {
  if (raw == null || raw === '') return 0
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  let s = String(raw).trim().replace(/,/g, '')
  if (!s || s === '-' || s === '—') return 0
  s = s.replace(/%$/, '')
  const wan = /万$/i.test(s) || /w$/i.test(s)
  if (wan) s = s.replace(/[万wW]$/, '')
  const n = Number(s)
  if (!Number.isFinite(n)) return 0
  return wan ? n * 10000 : n
}

function parseIntSafe(raw) {
  return Math.round(parseNumber(raw))
}

function pick(row, aliases) {
  if (!row || typeof row !== 'object') return ''
  const map = new Map()
  for (const [k, v] of Object.entries(row)) {
    map.set(normalizeKey(k), v)
  }
  for (const a of aliases) {
    const hit = map.get(normalizeKey(a))
    if (hit != null && String(hit).trim() !== '') return hit
  }
  return ''
}

function textOf(row, aliases) {
  const v = pick(row, aliases)
  return v == null ? '' : String(v).trim()
}

function looksLikeHeaderText(s) {
  return /推广链接|链接名称|落地页|端口名称|书籍ID|书籍id|书籍名称|书号|书名|素材|视频|封面/.test(String(s || ''))
}

function tableMatrixToRows(matrix) {
  if (!matrix || !matrix.length) return []
  let headerIdx = 0
  for (let i = 0; i < Math.min(matrix.length, 15); i += 1) {
    if (looksLikeHeaderText((matrix[i] || []).join('|'))) {
      headerIdx = i
      break
    }
  }
  const headers = (matrix[headerIdx] || []).map((h) => String(h == null ? '' : h).trim())
  if (!headers.some(Boolean)) return []
  const rows = []
  for (let i = headerIdx + 1; i < matrix.length; i += 1) {
    const cells = matrix[i] || []
    if (!cells.some((c) => String(c == null ? '' : c).trim())) continue
    const row = {}
    headers.forEach((h, idx) => {
      if (!h) return
      row[h] = cells[idx] != null ? cells[idx] : ''
    })
    rows.push(row)
  }
  return rows
}

function colLetterToIndex(ref) {
  const m = String(ref || '').match(/^([A-Za-z]+)/)
  if (!m) return 0
  let n = 0
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return Math.max(0, n - 1)
}

function decodeXmlText(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function findZipEocd(buf) {
  const start = Math.max(0, buf.length - 22 - 65536)
  for (let i = buf.length - 22; i >= start; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  return -1
}

function readZipEntries(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf)
  const files = new Map()
  const eocd = findZipEocd(buf)
  if (eocd < 0) return files
  const cdCount = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < cdCount; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen).replace(/\\/g, '/')
    if (localOff + 30 <= buf.length && buf.readUInt32LE(localOff) === 0x04034b50) {
      const localNameLen = buf.readUInt16LE(localOff + 26)
      const localExtraLen = buf.readUInt16LE(localOff + 28)
      const dataStart = localOff + 30 + localNameLen + localExtraLen
      const data = buf.subarray(dataStart, dataStart + compSize)
      let content = data
      if (method === 8) content = zlib.inflateRawSync(data)
      else if (method !== 0) content = Buffer.alloc(0)
      files.set(name, content.toString('utf8'))
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return files
}

function parseSharedStrings(xml) {
  const strings = []
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g
  let m
  while ((m = re.exec(xml || ''))) {
    const texts = [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXmlText(x[1]))
    strings.push(texts.join(''))
  }
  return strings
}

function parseSheetMatrix(xml, strings) {
  const matrix = []
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g
  let rowMatch
  while ((rowMatch = rowRe.exec(xml || ''))) {
    const cells = []
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g
    let cellMatch
    while ((cellMatch = cellRe.exec(rowMatch[1] || ''))) {
      const attrs = cellMatch[1] || cellMatch[3] || ''
      const inner = cellMatch[2] || ''
      const ref = (attrs.match(/\br="([^"]+)"/) || [])[1] || ''
      const type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || ''
      const idx = colLetterToIndex(ref)
      let value = ''
      if (type === 's') {
        const v = (inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1]
        value = strings[Number(v)] || ''
      } else if (type === 'inlineStr') {
        const texts = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXmlText(x[1]))
        value = texts.join('')
      } else {
        const v = (inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1]
        value = v != null ? decodeXmlText(v) : ''
      }
      cells[idx] = value
    }
    matrix.push(cells)
  }
  return matrix
}

function isXlsxBuffer(buf) {
  return Buffer.isBuffer(buf) && buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b
}

function parseXlsxBuffer(buf) {
  const files = readZipEntries(buf)
  const strings = parseSharedStrings(files.get('xl/sharedStrings.xml') || '')
  let sheetXml = files.get('xl/worksheets/sheet1.xml')
  if (!sheetXml) {
    const name = [...files.keys()].find((k) => /xl\/worksheets\/sheet\d+\.xml$/i.test(k))
    sheetXml = name ? files.get(name) : ''
  }
  if (!sheetXml) return []
  return tableMatrixToRows(parseSheetMatrix(sheetXml, strings))
}

function extractRows(input) {
  if (input == null) return []
  if (Buffer.isBuffer(input)) {
    if (isXlsxBuffer(input)) return parseXlsxBuffer(input)
    return extractRows(decodeBuffer(input))
  }
  if (typeof input === 'string') {
    const t = input.replace(/^\uFEFF/, '').trim()
    if (!t) return []
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        return extractRows(JSON.parse(t))
      } catch {
        return parseCsv(t)
      }
    }
    return parseCsv(t)
  }
  if (Array.isArray(input)) {
    if (input.length && input.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return input
    return []
  }
  if (typeof input === 'object') {
    const candidates = []
    const walk = (o, depth) => {
      if (!o || depth > 8) return
      if (Array.isArray(o)) {
        if (o.length && o.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
          candidates.push(o)
        } else {
          for (const item of o) walk(item, depth + 1)
        }
        return
      }
      if (typeof o === 'object') {
        for (const v of Object.values(o)) walk(v, depth + 1)
      }
    }
    walk(input, 0)
    if (!candidates.length) return []
    candidates.sort((a, b) => b.length - a.length)
    return candidates[0]
  }
  return []
}

function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return []
  const headerLine = lines.find((l) => looksLikeHeaderText(l)) || lines[0]
  let delim = ','
  if (headerLine.includes('\t') && !headerLine.includes(',')) delim = '\t'
  else if ((headerLine.match(/,/g) || []).length < 2 && (headerLine.match(/;/g) || []).length >= 2) delim = ';'
  return tableMatrixToRows(lines.map((l) => splitCsvLine(l, delim)))
}

function splitCsvLine(line, delim) {
  const out = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"'
        i += 1
      } else {
        inQuote = !inQuote
      }
    } else if (ch === delim && !inQuote) {
      out.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur.trim())
  return out
}

function mapBookRow(row) {
  const name = textOf(row, ['书籍名称', '书名', '作品名称', '作品名', 'bookName', 'book_name', 'name'])
  const externalBookId = textOf(row, [
    '书籍ID',
    '书籍id',
    '书号ID',
    '书号id',
    '书号',
    '作品ID',
    'bookId',
    'book_id',
    'bookNo',
  ])
  const store = textOf(row, ['书城', 'store', 'platform', 'channel'])
  const author = textOf(row, ['作品', '作者', 'author', 'writer'])
  const category = textOf(row, ['分类', 'category', 'genre'])
  return {
    name,
    externalBookId,
    store,
    author,
    wordCount: parseIntSafe(pick(row, ['字数', 'wordCount', 'words', 'word_count'])),
    category,
    rechargeUsers: parseIntSafe(pick(row, ['充值人数', 'rechargeUsers', 'payUsers'])),
    rechargeOrders: parseIntSafe(pick(row, ['充值订单', 'rechargeOrders', 'payOrders'])),
    avgOrders: parseNumber(pick(row, ['人均订单', 'avgOrders', 'avg_order'])),
    firstRechargeOrders: parseIntSafe(pick(row, ['首次充值订单', '首充订单', 'firstRechargeOrders'])),
    rechargeAmount: parseNumber(pick(row, ['充值金额', 'rechargeAmount', 'payAmount', 'amount'])),
    arpu: parseNumber(pick(row, ['充值ARPU', 'ARPU', 'arpu'])),
  }
}

function mapLibraryRow(row) {
  return {
    title: textOf(row, ['素材名称', '标题', 'title', 'name', '素材名']),
    externalId: textOf(row, ['素材ID', '素材id', 'materialId', 'material_id', 'id']),
    coverUrl: textOf(row, ['封面', '封面图', 'cover', 'coverUrl', 'thumb']),
    playUrl: textOf(row, ['视频', '视频链接', '播放地址', '素材链接', 'playUrl', 'videoUrl', 'url']),
    externalBookId: textOf(row, ['书号ID', '书号id', '书籍ID', '书籍id', 'bookId', 'book_id']),
    store: textOf(row, ['书城', 'store', 'platform']),
    heat: parseNumber(pick(row, ['热度', 'heat', 'hot'])),
  }
}

function splitUrlList(raw) {
  if (raw == null || raw === '') return []
  if (Array.isArray(raw)) {
    const out = []
    for (const item of raw) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const u = item.url || item.link || item.推广链接 || item.href
        if (u) out.push(String(u).trim())
      } else if (item != null && String(item).trim()) {
        out.push(String(item).trim())
      }
    }
    return out.filter(Boolean)
  }
  return String(raw)
    .split(/[\n\r|；;，]+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '-' && s !== '—')
}

function guessNameFromUrl(url) {
  const s = String(url || '').trim()
  if (!s) return ''
  try {
    const u = new URL(s)
    const last = u.pathname.split('/').filter(Boolean).pop() || ''
    return (last && decodeURIComponent(last).slice(0, 80)) || u.host
  } catch {
    return s.slice(0, 40)
  }
}

function mapPromoRow(row) {
  const urlRaw = pick(row, [
    '推广链接',
    '落地页',
    '落地页链接',
    '端口链接',
    '链接地址',
    'url',
    'link',
    'href',
    '链接',
  ])
  const urls = splitUrlList(urlRaw)
  const bookName = textOf(row, ['书籍名称', '书名', '作品名称', '作品名', 'bookName', 'book_name'])
  const name =
    textOf(row, ['链接名称', '推广名称', '端口名称', '端口名', '链接名', 'linkName', 'link_name', 'title', 'name']) ||
    bookName
  return {
    name,
    url: urls[0] || '',
    urls,
    channel: textOf(row, ['渠道', '端口类型', '平台', 'channel', 'platform']),
    store: textOf(row, ['书城', 'store']),
    externalBookId: textOf(row, ['书籍ID', '书籍id', '书号ID', '书号id', '书号', '作品ID', 'bookId', 'book_id']),
    bookName,
    externalId: textOf(row, ['链接ID', '推广ID', '端口ID', 'externalId', 'linkId']),
    remark: textOf(row, ['备注', 'remark']),
    status: /停|禁|inactive|off|0/i.test(String(pick(row, ['状态', 'status']) || '')) ? 'inactive' : 'active',
  }
}

function expandPromoRows(rows) {
  const out = []
  for (const row of rows) {
    const mapped = mapPromoRow(row)
    const extras = []
    const nested = row && (row.links || row.urls || row.推广链接列表)
    if (Array.isArray(nested)) extras.push(...splitUrlList(nested))
    const urls = [...mapped.urls, ...extras]
    const uniq = []
    const seen = new Set()
    for (const u of urls) {
      if (!u || seen.has(u)) continue
      seen.add(u)
      uniq.push(u)
    }
    if (!uniq.length) {
      out.push(row)
      continue
    }
    for (const url of uniq) {
      out.push({ ...row, 推广链接: url, url })
    }
  }
  return out
}

function upsertPromoLink(d, bookId, mapped) {
  const url = String(mapped.url || '').trim()
  if (!url) return { error: '缺少推广链接' }
  const name = String(mapped.name || '').trim()
  const channel = String(mapped.channel || '').trim()
  const store = String(mapped.store || '').trim()
  const remark = String(mapped.remark || '').trim()
  const externalId = String(mapped.externalId || '').trim()
  const status = mapped.status === 'inactive' ? 'inactive' : 'active'
  const existing = d.prepare('SELECT id FROM novel_promo_links WHERE book_id = ? AND url = ?').get(bookId, url)
  if (existing) {
    d.prepare(
      `UPDATE novel_promo_links SET
         name = CASE WHEN ? != '' THEN ? ELSE name END,
         channel = CASE WHEN ? != '' THEN ? ELSE channel END,
         store = CASE WHEN ? != '' THEN ? ELSE store END,
         remark = CASE WHEN ? != '' THEN ? ELSE remark END,
         external_id = CASE WHEN ? != '' THEN ? ELSE external_id END,
         status = ?,
         source = 'yunfan',
         updated_at = datetime('now')
       WHERE id = ?`,
    ).run(name, name, channel, channel, store, store, remark, remark, externalId, externalId, status, existing.id)
    return { id: existing.id, updated: true }
  }
  const r = d
    .prepare(
      `INSERT INTO novel_promo_links (book_id, name, url, store, channel, status, remark, external_id, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'yunfan', datetime('now'))`,
    )
    .run(bookId, name, url, store, channel, status, remark, externalId)
  return { id: Number(r.lastInsertRowid), created: true }
}

function resolvePromoBook(d, mapped) {
  if (mapped.externalBookId) {
    return upsertBook(d, {
      externalBookId: mapped.externalBookId,
      store: mapped.store || '',
      name: mapped.bookName || '',
      author: '',
      wordCount: 0,
      category: '',
    })
  }
  const bookName = String(mapped.bookName || '').trim()
  if (!bookName) return { error: '缺少书籍ID或书名' }
  const conds = ['name = ?']
  const params = [bookName]
  if (mapped.store) {
    conds.push('store = ?')
    params.push(mapped.store)
  }
  const hits = d.prepare(`SELECT id FROM novel_books WHERE ${conds.join(' AND ')}`).all(...params)
  if (hits.length === 1) return { id: hits[0].id }
  if (hits.length > 1) return { error: '书名对应多本书，请带上书籍ID' }
  return { error: '缺少书籍ID，且未找到同名书籍' }
}

function importPromo(d, rows) {
  const expanded = expandPromoRows(rows)
  const fails = []
  let success = 0
  for (let i = 0; i < expanded.length; i += 1) {
    const mapped = mapPromoRow(expanded[i])
    if (!mapped.url) {
      fails.push({ index: i + 1, reason: '缺少推广链接' })
      continue
    }
    if (!mapped.name) mapped.name = guessNameFromUrl(mapped.url)
    const book = resolvePromoBook(d, mapped)
    if (book.error) {
      fails.push({ index: i + 1, reason: book.error })
      continue
    }
    const link = upsertPromoLink(d, book.id, mapped)
    if (link.error) {
      fails.push({ index: i + 1, reason: link.error })
      continue
    }
    success += 1
  }
  return { success, fails }
}

function mapPackRow(row) {
  const book = mapBookRow(row)
  const material = mapLibraryRow(row)
  const report = mapMaterialReportRow(row)
  return {
    externalBookId: book.externalBookId || material.externalBookId || report.externalBookId,
    store: book.store || material.store || report.store,
    name: book.name,
    author: book.author,
    wordCount: book.wordCount,
    category: book.category,
    title: material.title || report.title,
    externalId: material.externalId || report.externalId,
    playUrl: material.playUrl || report.playUrl,
    coverUrl: material.coverUrl || report.coverUrl,
    heat: material.heat || report.heat,
  }
}

function importPack(d, rows) {
  const fails = []
  let success = 0
  let newBooks = 0
  let newMaterials = 0
  let updatedBooks = 0
  let updatedMaterials = 0
  const seenBooks = new Set()
  for (let i = 0; i < rows.length; i += 1) {
    const mapped = mapPackRow(rows[i])
    if (!mapped.externalBookId) {
      fails.push({ index: i + 1, reason: '缺少书籍ID' })
      continue
    }
    const book = upsertBook(d, mapped)
    if (book.error) {
      fails.push({ index: i + 1, reason: book.error })
      continue
    }
    if (!seenBooks.has(book.id)) {
      seenBooks.add(book.id)
      if (book.created) newBooks += 1
      else updatedBooks += 1
    }
    if (!mapped.externalId && !mapped.playUrl) {
      success += 1
      continue
    }
    const material = upsertMaterial(d, mapped, book.id)
    if (material.error) {
      fails.push({ index: i + 1, reason: material.error })
      continue
    }
    if (material.created) newMaterials += 1
    else updatedMaterials += 1
    success += 1
  }
  return { success, fails, newBooks, newMaterials, updatedBooks, updatedMaterials }
}

function mapMaterialReportRow(row) {
  return {
    title: textOf(row, ['素材名称', '素材名', '标题', 'title', 'name']),
    externalId: textOf(row, ['素材ID', '素材id', 'materialId', 'material_id']),
    playUrl: textOf(row, ['视频', '素材链接', '播放地址', 'playUrl', 'videoUrl', 'url']),
    coverUrl: textOf(row, ['封面', '封面图', 'cover']),
    cost: parseNumber(pick(row, ['消耗', 'cost', 'spend'])),
    impressions: parseIntSafe(pick(row, ['展示', 'impressions', 'show'])),
    clicks: parseIntSafe(pick(row, ['点击', 'clicks'])),
    ctr: parseNumber(pick(row, ['点击率', '平均点击率', 'ctr'])),
    conversions: parseIntSafe(pick(row, ['转化', 'conversions', 'convert'])),
    rechargeAmount: parseNumber(pick(row, ['充值金额', 'rechargeAmount', 'payAmount'])),
    heat: parseNumber(pick(row, ['热度', 'heat'])),
    externalBookId: textOf(row, ['书号ID', '书号id', '书籍ID', '书籍id', 'bookId']),
    store: textOf(row, ['书城', 'store']),
  }
}

function upsertBook(d, mapped) {
  const externalBookId = String(mapped.externalBookId || '').trim()
  if (!externalBookId) return { error: '缺少书籍ID' }
  const store = String(mapped.store || '').trim()
  const existing = d
    .prepare('SELECT id FROM novel_books WHERE store = ? AND external_book_id = ?')
    .get(store, externalBookId)
  const name = String(mapped.name || '').trim()
  const author = String(mapped.author || '').trim()
  const category = String(mapped.category || '').trim()
  const wordCount = Number(mapped.wordCount) || 0
  if (existing) {
    d.prepare(
      `UPDATE novel_books SET
         name = CASE WHEN ? != '' THEN ? ELSE name END,
         author = CASE WHEN ? != '' THEN ? ELSE author END,
         category = CASE WHEN ? != '' THEN ? ELSE category END,
         word_count = CASE WHEN ? > 0 THEN ? ELSE word_count END,
         last_seen_at = datetime('now'),
         updated_at = datetime('now')
       WHERE id = ?`,
    ).run(name, name, author, author, category, category, wordCount, wordCount, existing.id)
    return { id: existing.id, created: false }
  }
  const r = d
    .prepare(
      `INSERT INTO novel_books (external_book_id, store, name, author, word_count, category, first_seen_at, last_seen_at, launch_status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'pending', datetime('now'))`,
    )
    .run(externalBookId, store, name, author, wordCount, category)
  return { id: Number(r.lastInsertRowid), created: true }
}

function upsertBookSnapshot(d, bookId, mapped, statDate, slot, batchId) {
  d.prepare(
    `INSERT INTO novel_book_snapshots (
       book_id, stat_date, slot, recharge_users, recharge_orders, avg_orders,
       first_recharge_orders, recharge_amount, arpu, is_hot, batch_id, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, datetime('now'))
     ON CONFLICT(book_id, stat_date, slot) DO UPDATE SET
       recharge_users = excluded.recharge_users,
       recharge_orders = excluded.recharge_orders,
       avg_orders = excluded.avg_orders,
       first_recharge_orders = excluded.first_recharge_orders,
       recharge_amount = excluded.recharge_amount,
       arpu = excluded.arpu,
       batch_id = excluded.batch_id,
       updated_at = datetime('now')`,
  ).run(
    bookId,
    statDate,
    slot,
    mapped.rechargeUsers || 0,
    mapped.rechargeOrders || 0,
    mapped.avgOrders || 0,
    mapped.firstRechargeOrders || 0,
    mapped.rechargeAmount || 0,
    mapped.arpu || 0,
    batchId,
  )
}

function findMaterial(d, mapped) {
  const externalId = String(mapped.externalId || '').trim()
  if (externalId) {
    const byExt = d.prepare('SELECT * FROM novel_materials WHERE external_id = ? LIMIT 1').get(externalId)
    if (byExt) return byExt
  }
  const playUrl = String(mapped.playUrl || '').trim()
  if (playUrl) {
    const byUrl = d.prepare('SELECT * FROM novel_materials WHERE play_url = ? LIMIT 1').get(playUrl)
    if (byUrl) return byUrl
  }
  return null
}

function upsertMaterial(d, mapped, bookId) {
  const existing = findMaterial(d, mapped)
  const title = String(mapped.title || '').trim()
  const coverUrl = String(mapped.coverUrl || '').trim()
  const playUrl = String(mapped.playUrl || '').trim()
  const externalId = String(mapped.externalId || '').trim()
  const heat = Number(mapped.heat) || 0
  if (!existing && !externalId && !playUrl) return { error: '缺少素材ID或视频链接' }
  if (existing) {
    d.prepare(
      `UPDATE novel_materials SET
         book_id = CASE WHEN ? IS NOT NULL THEN ? ELSE book_id END,
         external_id = CASE WHEN ? != '' THEN ? ELSE external_id END,
         title = CASE WHEN ? != '' THEN ? ELSE title END,
         cover_url = CASE WHEN ? != '' THEN ? ELSE cover_url END,
         play_url = CASE WHEN ? != '' THEN ? ELSE play_url END,
         heat = CASE WHEN ? > 0 THEN ? ELSE heat END,
         last_seen_at = datetime('now'),
         updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      bookId,
      bookId,
      externalId,
      externalId,
      title,
      title,
      coverUrl,
      coverUrl,
      playUrl,
      playUrl,
      heat,
      heat,
      existing.id,
    )
    return { id: existing.id, created: false }
  }
  const r = d
    .prepare(
      `INSERT INTO novel_materials (book_id, external_id, title, cover_url, play_url, heat, first_seen_at, last_seen_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))`,
    )
    .run(bookId, externalId, title, coverUrl, playUrl, heat)
  return { id: Number(r.lastInsertRowid), created: true }
}

function upsertMaterialSnapshot(d, materialId, mapped, statDate, slot, batchId) {
  d.prepare(
    `INSERT INTO novel_material_snapshots (
       material_id, stat_date, slot, cost, impressions, clicks, ctr,
       conversions, recharge_amount, heat, is_hot, batch_id, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, datetime('now'))
     ON CONFLICT(material_id, stat_date, slot) DO UPDATE SET
       cost = excluded.cost,
       impressions = excluded.impressions,
       clicks = excluded.clicks,
       ctr = excluded.ctr,
       conversions = excluded.conversions,
       recharge_amount = excluded.recharge_amount,
       heat = excluded.heat,
       batch_id = excluded.batch_id,
       updated_at = datetime('now')`,
  ).run(
    materialId,
    statDate,
    slot,
    mapped.cost || 0,
    mapped.impressions || 0,
    mapped.clicks || 0,
    mapped.ctr || 0,
    mapped.conversions || 0,
    mapped.rechargeAmount || 0,
    mapped.heat || 0,
    batchId,
  )
}

function markBookHots(d, statDate, slot) {
  const rows = d
    .prepare(
      `SELECT id, recharge_amount FROM novel_book_snapshots
       WHERE stat_date = ? AND slot = ?
       ORDER BY recharge_amount DESC, id ASC`,
    )
    .all(statDate, slot)
  const hotIds = new Set()
  rows.forEach((r, idx) => {
    if (idx < BOOK_HOT_TOP_N || Number(r.recharge_amount) >= BOOK_HOT_AMOUNT) hotIds.add(r.id)
  })
  const upd = d.prepare('UPDATE novel_book_snapshots SET is_hot = ? WHERE id = ?')
  for (const r of rows) upd.run(hotIds.has(r.id) ? 1 : 0, r.id)
}

function markMaterialHots(d, statDate, slot) {
  const rows = d
    .prepare(
      `SELECT id, cost, recharge_amount, heat FROM novel_material_snapshots
       WHERE stat_date = ? AND slot = ?`,
    )
    .all(statDate, slot)
  const byHeat = [...rows].sort((a, b) => Number(b.heat) - Number(a.heat))
  const heatHot = new Set(byHeat.slice(0, MATERIAL_HOT_HEAT_TOP_N).map((r) => r.id))
  const upd = d.prepare('UPDATE novel_material_snapshots SET is_hot = ? WHERE id = ?')
  const touchHot = d.prepare(
    `UPDATE novel_materials SET convert_status = 'hot', updated_at = datetime('now')
     WHERE id = (SELECT material_id FROM novel_material_snapshots WHERE id = ?)
       AND convert_status = 'collected'`,
  )
  for (const r of rows) {
    const cost = Number(r.cost) || 0
    const amount = Number(r.recharge_amount) || 0
    let hot = false
    if (cost > 0) {
      const roi = amount / cost
      hot = roi >= MATERIAL_HOT_ROI && amount >= MATERIAL_HOT_AMOUNT
    } else {
      hot = Number(r.heat) > 0 && heatHot.has(r.id)
    }
    upd.run(hot ? 1 : 0, r.id)
    if (hot) touchHot.run(r.id)
  }
}

function resolveBookId(d, mapped) {
  const externalBookId = String(mapped.externalBookId || '').trim()
  if (!externalBookId) return null
  return upsertBook(d, {
    externalBookId,
    store: mapped.store || '',
    name: mapped.name || '',
    author: '',
    wordCount: 0,
    category: '',
  }).id
}

function importBooks(d, rows, statDate, slot, batchId) {
  const fails = []
  let success = 0
  for (let i = 0; i < rows.length; i += 1) {
    const mapped = mapBookRow(rows[i])
    const book = upsertBook(d, mapped)
    if (book.error) {
      fails.push({ index: i + 1, reason: book.error })
      continue
    }
    upsertBookSnapshot(d, book.id, mapped, statDate, slot, batchId)
    success += 1
  }
  markBookHots(d, statDate, slot)
  return { success, fails }
}

function importLibrary(d, rows, statDate, slot, batchId) {
  const fails = []
  let success = 0
  for (let i = 0; i < rows.length; i += 1) {
    const mapped = mapLibraryRow(rows[i])
    const bookId = resolveBookId(d, mapped)
    const material = upsertMaterial(d, mapped, bookId)
    if (material.error) {
      fails.push({ index: i + 1, reason: material.error })
      continue
    }
    upsertMaterialSnapshot(
      d,
      material.id,
      { heat: mapped.heat, cost: 0, impressions: 0, clicks: 0, ctr: 0, conversions: 0, rechargeAmount: 0 },
      statDate,
      slot,
      batchId,
    )
    success += 1
  }
  markMaterialHots(d, statDate, slot)
  return { success, fails }
}

function importMaterials(d, rows, statDate, slot, batchId) {
  const fails = []
  let success = 0
  for (let i = 0; i < rows.length; i += 1) {
    const mapped = mapMaterialReportRow(rows[i])
    const bookId = resolveBookId(d, mapped)
    const material = upsertMaterial(d, mapped, bookId)
    if (material.error) {
      fails.push({ index: i + 1, reason: material.error })
      continue
    }
    upsertMaterialSnapshot(d, material.id, mapped, statDate, slot, batchId)
    success += 1
  }
  markMaterialHots(d, statDate, slot)
  return { success, fails }
}

function decodeBuffer(buf) {
  if (!buf) return ''
  const utf8 = buf.toString('utf8')
  if (utf8.includes('\uFFFD') && buf[0] !== 0xef) {
    try {
      return buf.toString('utf16le')
    } catch {
      return utf8
    }
  }
  return utf8
}

function runImport({ db: d, type, statDate, slot, filename, userId, text, json, buffer }) {
  const t = String(type || '').trim()
  if (!IMPORT_TYPES.includes(t)) {
    return { error: '导入类型无效' }
  }
  let date = String(statDate || '').trim()
  if (!date && (t === TYPE_PROMO || t === TYPE_PACK)) date = todayLocal()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: '请选择统计日期' }
  const s = slot === SLOT_AFTERNOON || slot === SLOT_MORNING ? slot : inferSlot()

  let rows = []
  if (buffer && isXlsxBuffer(buffer)) rows = parseXlsxBuffer(buffer)
  else if (json != null) rows = extractRows(json)
  else if (buffer) rows = extractRows(buffer)
  else rows = extractRows(text)
  if (!rows.length) return { error: '没有解析到数据行，请上传 xlsx / CSV，或粘贴 JSON' }

  const ins = d
    .prepare(
      `INSERT INTO novel_sync_batches (type, stat_date, slot, filename, status, user_id)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    )
    .run(t, date, s, filename || '', userId || null)
  const batchId = Number(ins.lastInsertRowid)

  let result
  try {
    const tx = d.transaction(() => {
      if (t === TYPE_PACK) return importPack(d, rows)
      if (t === TYPE_BOOKS) return importBooks(d, rows, date, s, batchId)
      if (t === TYPE_LIBRARY) return importLibrary(d, rows, date, s, batchId)
      if (t === TYPE_PROMO) return importPromo(d, rows)
      return importMaterials(d, rows, date, s, batchId)
    })
    result = tx()
  } catch (e) {
    d.prepare(
      `UPDATE novel_sync_batches
       SET status = 'failed', error_message = ?, finished_at = datetime('now')
       WHERE id = ?`,
    ).run(String(e.message || e), batchId)
    return { error: `导入失败：${e.message || e}`, batchId }
  }

  const failCount = result.fails.length
  const status = failCount === 0 ? 'success' : result.success > 0 ? 'partial' : 'failed'
  const failReasons = result.fails.slice(0, 50)
  const totalCount = result.success + failCount
  d.prepare(
    `UPDATE novel_sync_batches
     SET status = ?, total_count = ?, success_count = ?, fail_count = ?,
         error_message = ?, fail_reasons = ?, finished_at = datetime('now')
     WHERE id = ?`,
  ).run(
    status,
    totalCount,
    result.success,
    failCount,
    failCount ? `${failCount} 行未写入` : '',
    failCount ? JSON.stringify(failReasons) : '',
    batchId,
  )

  return {
    batchId,
    type: t,
    statDate: date,
    slot: s,
    total: totalCount,
    success: result.success,
    fail: failCount,
    status,
    fails: failReasons,
    newBooks: Number(result.newBooks || 0),
    newMaterials: Number(result.newMaterials || 0),
    updatedBooks: Number(result.updatedBooks || 0),
    updatedMaterials: Number(result.updatedMaterials || 0),
  }
}

module.exports = {
  TYPE_BOOKS,
  TYPE_LIBRARY,
  TYPE_MATERIALS,
  TYPE_PROMO,
  TYPE_PACK,
  IMPORT_TYPES,
  SLOT_MORNING,
  SLOT_AFTERNOON,
  inferSlot,
  todayLocal,
  extractRows,
  parseCsv,
  parseXlsxBuffer,
  tableMatrixToRows,
  parseNumber,
  splitUrlList,
  mapBookRow,
  mapLibraryRow,
  mapPromoRow,
  mapMaterialReportRow,
  mapPackRow,
  runImport,
}
