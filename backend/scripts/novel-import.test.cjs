/**
 * 小说投流导入解析烟测（不连业务库）
 * 运行：node scripts/novel-import.test.cjs
 */
const assert = require('assert')
const Database = require('better-sqlite3')
const zlib = require('zlib')
const {
  extractRows,
  parseCsv,
  parseXlsxBuffer,
  parseNumber,
  mapBookRow,
  mapLibraryRow,
  mapPromoRow,
  mapPackRow,
  runImport,
} = require('../services/novelImportService')
const {
  parseChannels,
  signKey,
  normalizeMediaSource,
  isLockedRechargeName,
  isDisabledRechargeName,
  publicConfigPromoName,
  isRealBookName,
  parseBookIds,
} = require('../services/dianzhongPromoClient')

assert.strictEqual(parseNumber('1,286.5'), 1286.5)
assert.strictEqual(parseNumber('5.0W'), 50000)
assert.strictEqual(parseNumber('1.5万'), 15000)
assert.strictEqual(parseNumber('4.12%'), 4.12)

const fromCsv = parseCsv('书籍名称,书籍ID,书城,充值金额\n测试书,B100,番茄,366.5')
assert.strictEqual(fromCsv.length, 1)
assert.strictEqual(mapBookRow(fromCsv[0]).externalBookId, 'B100')
assert.strictEqual(mapBookRow(fromCsv[0]).rechargeAmount, 366.5)

const nested = extractRows({
  code: 0,
  data: { list: [{ 书名: ' Nested', 书籍ID: 'X1', 书城: '七猫', 充值金额: '88' }] },
})
assert.strictEqual(nested.length, 1)
assert.strictEqual(mapBookRow(nested[0]).name, 'Nested')

const lib = mapLibraryRow({ 书号ID: 'X1', 书城: '七猫', 视频: 'https://a.mp4', 热度: '1.2W' })
assert.strictEqual(lib.externalBookId, 'X1')
assert.strictEqual(lib.heat, 12000)

const mem = new Database(':memory:')
mem.exec(`
  CREATE TABLE novel_books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_book_id TEXT NOT NULL,
    store TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    word_count INTEGER DEFAULT 0,
    category TEXT NOT NULL DEFAULT '',
    first_seen_at TEXT DEFAULT (datetime('now')),
    last_seen_at TEXT DEFAULT (datetime('now')),
    launch_status TEXT NOT NULL DEFAULT 'pending',
    launched_at TEXT,
    launch_user_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(store, external_book_id)
  );
  CREATE TABLE novel_book_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    stat_date TEXT NOT NULL,
    slot TEXT NOT NULL DEFAULT 'morning',
    recharge_users INTEGER DEFAULT 0,
    recharge_orders INTEGER DEFAULT 0,
    avg_orders REAL DEFAULT 0,
    first_recharge_orders INTEGER DEFAULT 0,
    recharge_amount REAL DEFAULT 0,
    arpu REAL DEFAULT 0,
    is_hot INTEGER DEFAULT 0,
    batch_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(book_id, stat_date, slot)
  );
  CREATE TABLE novel_materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER,
    external_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '',
    play_url TEXT NOT NULL DEFAULT '',
    heat REAL DEFAULT 0,
    convert_status TEXT NOT NULL DEFAULT 'collected',
    converted_url TEXT NOT NULL DEFAULT '',
    convert_remark TEXT NOT NULL DEFAULT '',
    convert_user_id INTEGER,
    convert_at TEXT,
    first_seen_at TEXT DEFAULT (datetime('now')),
    last_seen_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  );
  CREATE TABLE novel_material_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL,
    stat_date TEXT NOT NULL,
    slot TEXT NOT NULL DEFAULT 'morning',
    cost REAL DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    ctr REAL DEFAULT 0,
    conversions INTEGER DEFAULT 0,
    recharge_amount REAL DEFAULT 0,
    heat REAL DEFAULT 0,
    is_hot INTEGER DEFAULT 0,
    batch_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(material_id, stat_date, slot)
  );
  CREATE TABLE novel_promo_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL,
    store TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    remark TEXT NOT NULL DEFAULT '',
    external_id TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    referral_id TEXT NOT NULL DEFAULT '',
    media_source TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL DEFAULT '',
    monitor1 TEXT NOT NULL DEFAULT '',
    monitor2 TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(book_id, url)
  );
  CREATE TABLE novel_sync_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    stat_date TEXT NOT NULL,
    slot TEXT NOT NULL DEFAULT 'morning',
    filename TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    total_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    error_message TEXT NOT NULL DEFAULT '',
    fail_reasons TEXT,
    user_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    finished_at TEXT
  );
`)

const first = runImport({
  db: mem,
  type: 'books',
  statDate: '2026-10-13',
  slot: 'morning',
  filename: 'books.json',
  userId: 1,
  json: [
    { 书籍名称: '好书A', 书籍ID: '1001', 书城: '番茄', 充值金额: 800, 充值人数: 10 },
    { 书籍名称: '好书B', 书籍ID: '1002', 书城: '番茄', 充值金额: 80, 充值人数: 2 },
  ],
})
assert.strictEqual(first.success, 2)
assert.strictEqual(first.status, 'success')

const again = runImport({
  db: mem,
  type: 'books',
  statDate: '2026-10-13',
  slot: 'morning',
  filename: 'books2.json',
  userId: 1,
  json: [{ 书籍名称: '好书A改名', 书籍ID: '1001', 书城: '番茄', 充值金额: 900 }],
})
assert.strictEqual(again.success, 1)
const books = mem.prepare('SELECT COUNT(*) AS c FROM novel_books').get()
assert.strictEqual(books.c, 2)
const snaps = mem.prepare('SELECT COUNT(*) AS c FROM novel_book_snapshots').get()
assert.strictEqual(snaps.c, 2)
const renamed = mem.prepare("SELECT name FROM novel_books WHERE external_book_id = '1001'").get()
assert.strictEqual(renamed.name, '好书A改名')

const afternoon = runImport({
  db: mem,
  type: 'books',
  statDate: '2026-10-13',
  slot: 'afternoon',
  filename: 'pm.json',
  userId: 1,
  json: [{ 书籍名称: '好书A', 书籍ID: '1001', 书城: '番茄', 充值金额: 1200 }],
})
assert.strictEqual(afternoon.success, 1)
assert.strictEqual(mem.prepare('SELECT COUNT(*) AS c FROM novel_book_snapshots').get().c, 3)

const libImport = runImport({
  db: mem,
  type: 'library',
  statDate: '2026-10-13',
  slot: 'afternoon',
  filename: 'lib.json',
  userId: 1,
  json: [{ 书号ID: '1001', 书城: '番茄', 视频: 'https://cdn.example/a.mp4', 封面: 'https://cdn.example/a.jpg', 热度: '9.0W' }],
})
assert.strictEqual(libImport.success, 1)
const mat = mem.prepare('SELECT book_id, heat FROM novel_materials').get()
assert.ok(mat.book_id)
assert.strictEqual(mat.heat, 90000)

const promo = runImport({
  db: mem,
  type: 'promo',
  statDate: '2026-10-13',
  slot: 'afternoon',
  filename: 'promo.json',
  userId: 1,
  json: [
    {
      书籍ID: '1001',
      书籍名称: '好书A',
      书城: '番茄',
      推广链接: ['https://example.com/a1', 'https://example.com/a2'],
      渠道: '抖音',
    },
    {
      书籍ID: '1001',
      书城: '番茄',
      推广链接: 'https://example.com/a1',
    },
  ],
})
assert.strictEqual(promo.success, 3)
assert.strictEqual(mem.prepare('SELECT COUNT(*) AS c FROM novel_promo_links').get().c, 2)
assert.strictEqual(
  mem.prepare("SELECT COUNT(*) AS c FROM novel_promo_links WHERE book_id = (SELECT id FROM novel_books WHERE external_book_id = '1001')").get().c,
  2,
)

const promoCsv = runImport({
  db: mem,
  type: 'promo',
  statDate: '2026-10-13',
  slot: 'afternoon',
  filename: 'promo.csv',
  userId: 1,
  text: '书籍ID,书城,推广链接\n1002,番茄,https://example.com/b1\n1002,番茄,https://example.com/b2',
})
assert.strictEqual(promoCsv.success, 2)
assert.strictEqual(mem.prepare('SELECT COUNT(*) AS c FROM novel_promo_links').get().c, 4)

const tableCsv = parseCsv(
  '仅显示前100页，其他数据可导出查看\n链接名称,推广链接,书籍名称,书籍ID,书城,状态,消耗\n抖音投放A,https://example.com/table-a,好书A,1001,番茄,启用,12.5\n快手投放B,https://example.com/table-b,好书B,1002,番茄,启用,0',
)
assert.strictEqual(tableCsv.length, 2)
assert.strictEqual(mapPromoRow(tableCsv[0]).name, '抖音投放A')
assert.strictEqual(mapPromoRow(tableCsv[0]).url, 'https://example.com/table-a')
assert.strictEqual(mapPromoRow(tableCsv[0]).bookName, '好书A')
assert.strictEqual(mapPromoRow(tableCsv[0]).externalBookId, '1001')

const tableImport = runImport({
  db: mem,
  type: 'promo',
  statDate: '2026-10-13',
  slot: 'afternoon',
  filename: 'yunfan-promo.xlsx.csv',
  userId: 1,
  text: '仅显示前100页，其他数据可导出查看\n链接名称,推广链接,书籍名称,书籍ID,书城,状态\n抖音投放A,https://example.com/table-a,好书A,1001,番茄,启用',
})
assert.strictEqual(tableImport.success, 1)
const named = mem.prepare("SELECT name FROM novel_promo_links WHERE url = 'https://example.com/table-a'").get()
assert.strictEqual(named.name, '抖音投放A')

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i]
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function zipStore(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, text] of files) {
    const raw = Buffer.from(text, 'utf8')
    const def = zlib.deflateRawSync(raw)
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(raw)
    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(def.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    nameBuf.copy(local, 30)
    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(def.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)
    locals.push(Buffer.concat([local, def]))
    centrals.push(central)
    offset += local.length + def.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

const xlsxBuf = zipStore([
  [
    'xl/sharedStrings.xml',
    '<?xml version="1.0"?><sst><si><t>链接名称</t></si><si><t>推广链接</t></si><si><t>书籍名称</t></si><si><t>书籍ID</t></si><si><t>xlsx投放</t></si><si><t>https://example.com/xlsx-a</t></si><si><t>好书A</t></si><si><t>1001</t></si></sst>',
  ],
  [
    'xl/worksheets/sheet1.xml',
    '<?xml version="1.0"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="C2" t="s"><v>6</v></c><c r="D2" t="s"><v>7</v></c></row>' +
      '</sheetData></worksheet>',
  ],
])
const fromXlsx = parseXlsxBuffer(xlsxBuf)
assert.strictEqual(fromXlsx.length, 1)
assert.strictEqual(mapPromoRow(fromXlsx[0]).name, 'xlsx投放')
assert.strictEqual(mapPromoRow(fromXlsx[0]).url, 'https://example.com/xlsx-a')

const packed = mapPackRow({
  书名: '新书C',
  书籍ID: '2001',
  书城: '点众',
  素材ID: 'M1',
  视频: 'https://cdn.example/c1.mp4',
  封面: 'https://cdn.example/c1.jpg',
})
assert.strictEqual(packed.externalBookId, '2001')
assert.strictEqual(packed.playUrl, 'https://cdn.example/c1.mp4')
assert.strictEqual(packed.name, '新书C')

const packFirst = runImport({
  db: mem,
  type: 'pack',
  filename: '投放素材_每本100条.csv',
  userId: 1,
  json: [
    { 书名: '新书C', 书籍ID: '2001', 书城: '点众', 素材ID: 'M1', 视频: 'https://cdn.example/c1.mp4' },
    { 书名: '新书C', 书籍ID: '2001', 书城: '点众', 素材ID: 'M2', 视频: 'https://cdn.example/c2.mp4' },
    { 书名: '好书A改名', 书籍ID: '1001', 书城: '番茄', 视频: 'https://cdn.example/a.mp4' },
  ],
})
assert.strictEqual(packFirst.status, 'success')
assert.strictEqual(packFirst.newBooks, 1)
assert.strictEqual(packFirst.newMaterials, 2)
assert.strictEqual(packFirst.updatedBooks, 1)
assert.strictEqual(packFirst.updatedMaterials, 1)

const packAgain = runImport({
  db: mem,
  type: 'pack',
  filename: '投放素材_每本100条_2.csv',
  userId: 1,
  json: [
    { 书名: '新书C', 书籍ID: '2001', 书城: '点众', 素材ID: 'M1', 视频: 'https://cdn.example/c1.mp4' },
    { 书名: '新书C', 书籍ID: '2001', 书城: '点众', 素材ID: 'M2', 视频: 'https://cdn.example/c2.mp4' },
  ],
})
assert.strictEqual(packAgain.newBooks, 0)
assert.strictEqual(packAgain.newMaterials, 0)
assert.strictEqual(packAgain.updatedBooks, 1)
assert.strictEqual(packAgain.updatedMaterials, 2)

assert.strictEqual(signKey('10006007', 'token', '1710000000'), require('crypto').createHash('md5').update('10006007token1710000000').digest('hex'))
assert.strictEqual(normalizeMediaSource('KS'), 'ks')
assert.strictEqual(normalizeMediaSource('other'), 'dy')

const parsed = parseChannels('117110:巨量1,117111:巨量2,117112:巨量3,117113:巨量4')
assert.strictEqual(parsed.length, 4)
assert.strictEqual(parsed[0].id, '117110')
assert.strictEqual(parsed[0].label, '巨量1')
assert.strictEqual(parsed[3].id, '117113')
assert.deepStrictEqual(parseChannels('117110'), [{ id: '117110', label: '117110' }])
assert.deepStrictEqual(parseChannels(''), [])
assert.strictEqual(parseChannels('117110:巨量1,117110:重复').length, 1)

assert.strictEqual(isLockedRechargeName('9.9'), true)
assert.strictEqual(isLockedRechargeName('39.9'), true)
assert.strictEqual(isLockedRechargeName('爆量模板系统推荐'), false)
assert.strictEqual(isDisabledRechargeName('爆量模板系统推荐'), true)
assert.strictEqual(isDisabledRechargeName('保留档'), true)
assert.strictEqual(isDisabledRechargeName('9.9'), false)
assert.strictEqual(isRealBookName('夏日谎'), true)
assert.strictEqual(isRealBookName(''), false)
assert.strictEqual(isRealBookName('点众-倾心书馆-公共配置-9.9'), false)
assert.strictEqual(publicConfigPromoName('9.9'), '点众-倾心书馆-公共配置-9.9')
assert.strictEqual(publicConfigPromoName('39.9'), '点众-倾心书馆-公共配置-39.9')
assert.deepStrictEqual(parseBookIds('11010566526\n11010558571'), ['11010566526', '11010558571'])
assert.deepStrictEqual(parseBookIds('11010566526, 11010558571，11010566526'), ['11010566526', '11010558571'])

console.log('novel-import.test.cjs ok')
