const db = require('../db')

const ROI_NAME = '付费ROI'
const PAY_NAME = '付费'
const ROI_TIERS = [
  { tier: '1.9', bid: 2.1 },
  { tier: '2.9', bid: 3.1 },
  { tier: '3.9', bid: 4.1 },
  { tier: '9.9', bid: 13 },
  { tier: '29.9', bid: 32 },
  { tier: '39.9', bid: 43 },
]
const PAY_TIERS = [
  { tier: '1.9', bid: 1.6 },
  { tier: '2.9', bid: 2.45 },
  { tier: '3.9', bid: 3.28 },
  { tier: '9.9', bid: 8.38 },
  { tier: '29.9', bid: 25.22 },
  { tier: '39.9', bid: 33.65 },
]

function database() {
  return db.getDb()
}

function money(value) {
  const num = Math.round(Number(value) * 100) / 100
  return Number.isFinite(num) ? num : 0
}

function moneyText(value) {
  const num = money(value)
  if (!num) return ''
  return String(num)
}

function parseTiers(text) {
  try {
    const rows = JSON.parse(text || '[]')
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

function isDual(tiers) {
  return tiers.some((item) => item && item.bid == null && (item.roiBid != null || item.payBid != null))
}

function normalizeTiers(raw) {
  const rows = []
  const seen = new Set()
  for (const item of Array.isArray(raw) ? raw : []) {
    const tier = String((item && item.tier) || '').trim()
    if (!/^\d+(\.\d+)?$/.test(tier) || seen.has(tier)) continue
    const bid = money(item.bid != null ? item.bid : item.roiBid)
    if (bid < 0.01 || bid > 9999) continue
    seen.add(tier)
    rows.push({ tier, bid })
    if (rows.length >= 20) break
  }
  rows.sort((a, b) => Number(a.tier) - Number(b.tier))
  return rows
}

function sideTiers(raw, key) {
  const rows = []
  const seen = new Set()
  for (const item of Array.isArray(raw) ? raw : []) {
    const tier = String((item && item.tier) || '').trim()
    if (!/^\d+(\.\d+)?$/.test(tier) || seen.has(tier)) continue
    const bid = money(item[key])
    if (bid < 0.01 || bid > 9999) continue
    seen.add(tier)
    rows.push({ tier, bid })
  }
  rows.sort((a, b) => Number(a.tier) - Number(b.tier))
  return rows
}

function summaryOf(tiers) {
  return (tiers || []).map((item) => `${item.tier}→${moneyText(item.bid)}`).join(' · ')
}

function mapRow(row) {
  const tiers = normalizeTiers(parseTiers(row.tiers))
  const ready = tiers.length ? tiers : ROI_TIERS.map((item) => ({ ...item }))
  return {
    id: row.id,
    name: row.name || ROI_NAME,
    tiers: ready,
    summary: summaryOf(ready),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  }
}

function insertPlan(name, tiers) {
  const inserted = database()
    .prepare(
      `INSERT INTO oceanengine_bid_strategies (name, tiers, created_at, updated_at)
       VALUES (?, ?, datetime('now'), datetime('now'))`,
    )
    .run(name, JSON.stringify(tiers))
  return Number(inserted.lastInsertRowid)
}

function rewireLaunchStrategies(roiId, payId) {
  let rows = []
  try {
    rows = database().prepare(`SELECT id, config FROM oceanengine_launch_strategies`).all()
  } catch {
    return
  }
  const update = database().prepare(`UPDATE oceanengine_launch_strategies SET config = ? WHERE id = ?`)
  for (const row of rows) {
    let config
    try {
      config = JSON.parse(row.config || '{}')
    } catch {
      continue
    }
    if (!config || typeof config !== 'object') continue
    const current = Number(config.bidStrategyId) || 0
    if (current && current !== roiId) continue
    const next = config.goal === '付费' ? payId : roiId
    if (current === next) continue
    config.bidStrategyId = next
    update.run(JSON.stringify(config), row.id)
  }
}

function migrateCombined() {
  const rows = database().prepare(`SELECT id, name, tiers FROM oceanengine_bid_strategies ORDER BY id`).all()
  if (!rows.length) {
    insertPlan(ROI_NAME, ROI_TIERS)
    insertPlan(PAY_NAME, PAY_TIERS)
    return
  }
  for (const row of rows) {
    const raw = parseTiers(row.tiers)
    if (!isDual(raw)) continue
    const roi = sideTiers(raw, 'roiBid')
    const pay = sideTiers(raw, 'payBid')
    const roiName = row.name === '默认出价' ? ROI_NAME : row.name
    database()
      .prepare(`UPDATE oceanengine_bid_strategies SET name = ?, tiers = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(roiName, JSON.stringify(roi.length ? roi : ROI_TIERS), row.id)
    const namedPay = database().prepare(`SELECT id FROM oceanengine_bid_strategies WHERE name = ? AND id != ?`).get(PAY_NAME, row.id)
    const payId = namedPay ? namedPay.id : insertPlan(PAY_NAME, pay.length ? pay : PAY_TIERS)
    rewireLaunchStrategies(row.id, payId)
  }
}

function list() {
  migrateCombined()
  return database()
    .prepare(`SELECT id, name, tiers, created_at, updated_at FROM oceanengine_bid_strategies ORDER BY id`)
    .all()
    .map(mapRow)
}

function get(id) {
  migrateCombined()
  const row = database()
    .prepare(`SELECT id, name, tiers, created_at, updated_at FROM oceanengine_bid_strategies WHERE id = ?`)
    .get(Number(id) || 0)
  return row ? mapRow(row) : null
}

function resolve(id) {
  return get(id) || list()[0] || null
}

function tierKeys(plan) {
  const rows = plan && Array.isArray(plan.tiers) ? plan.tiers.map((item) => item.tier) : []
  return rows.length ? rows : ROI_TIERS.map((item) => item.tier)
}

function bidFor(plan, tier) {
  const key = String(tier || '')
  const row = ((plan && plan.tiers) || []).find((item) => item.tier === key)
  if (!row) return 0
  return money(row.bid != null ? row.bid : row.roiBid)
}

function readInput(input) {
  const source = input && typeof input === 'object' ? input : {}
  const name = String(source.name || '').trim().slice(0, 40)
  const tiers = normalizeTiers(source.tiers)
  if (!name) return { error: '请填写策略名称' }
  if (!tiers.length) return { error: '至少留一档，出价要大于 0' }
  return { name, tiers }
}

function create(input) {
  const parsed = readInput(input)
  if (parsed.error) return parsed
  const dup = database().prepare(`SELECT id FROM oceanengine_bid_strategies WHERE name = ?`).get(parsed.name)
  if (dup) return { error: '已经有同名的出价策略' }
  return get(insertPlan(parsed.name, parsed.tiers))
}

function update(id, input) {
  const current = get(id)
  if (!current) return { error: '没有这个出价策略' }
  const parsed = readInput(input)
  if (parsed.error) return parsed
  const dup = database()
    .prepare(`SELECT id FROM oceanengine_bid_strategies WHERE name = ? AND id != ?`)
    .get(parsed.name, current.id)
  if (dup) return { error: '已经有同名的出价策略' }
  database()
    .prepare(`UPDATE oceanengine_bid_strategies SET name = ?, tiers = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(parsed.name, JSON.stringify(parsed.tiers), current.id)
  return get(current.id)
}

function remove(id) {
  const current = get(id)
  if (!current) return { error: '没有这个出价策略' }
  const count = database().prepare(`SELECT COUNT(*) AS n FROM oceanengine_bid_strategies`).get()
  if (count && Number(count.n) <= 1) return { error: '至少留一套出价策略' }
  database().prepare(`DELETE FROM oceanengine_bid_strategies WHERE id = ?`).run(current.id)
  return { id: current.id }
}

module.exports = {
  ROI_NAME,
  PAY_NAME,
  ROI_TIERS,
  PAY_TIERS,
  list,
  get,
  resolve,
  tierKeys,
  bidFor,
  create,
  update,
  remove,
}
