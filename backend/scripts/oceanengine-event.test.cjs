const assert = require('assert')
const events = require('../services/oceanengineEvent')

const body = events.stringifyOcean({
  advertiser_id: '1863711955555339',
  asset_id: '7622204508192179990',
  event_id: '20',
  track_types: ['MINI_PROGRAME_API'],
})
assert.strictEqual(
  body,
  '{"advertiser_id":1863711955555339,"asset_id":7622204508192179990,"event_id":20,"track_types":["MINI_PROGRAME_API"]}',
)
assert.strictEqual(events.stringifyOcean(['7622204508192179990'], 'asset_ids'), '[7622204508192179990]')

const ev = events.toEvent({
  event_id: 8,
  event_type: 'active_pay',
  event_cn_name: '付费',
  track_types: ['MINI_PROGRAME_API'],
  debugging_status: 'Inactive',
  create_time: '2026-10-20 17:12:32',
})
assert.strictEqual(ev.name, '付费')
assert.strictEqual(ev.eventId, '8')
assert.strictEqual(ev.trackLabels[0], '小程序API回传')
assert.strictEqual(ev.debuggingLabel, '未激活')

const asset = events.toAsset(
  {
    asset_id: '7622204508192179990',
    asset_name: '倾心书馆',
    share_type: 'MY_CREATIONS',
    asset_type: 'MINI_PROGRAME',
  },
  { micro_app_id: 'ttc326b59b5c10bae401', micro_app_instance_id: '7622204508192179990' },
)
assert.strictEqual(asset.microAppId, 'ttc326b59b5c10bae401')
assert.strictEqual(asset.microAppInstanceId, '7622204508192179990')
assert.strictEqual(asset.shareLabel, '我创建的')

assert.strictEqual(events.queryParam('asset_ids', ['1881069211596808']), '[1881069211596808]')

const rows = [
  { advertiserId: '1866874658269192', name: '侠客行-曜投-1-刚刚好-0604' },
  { advertiserId: '1866874744437063', name: '侠客行-曜投-1-刚刚好-0605' },
  { advertiserId: '1866874591854057', name: '同名' },
  { advertiserId: '1866874591854058', name: '同名' },
]
const resolved = events.resolveAccounts('1866874658269192\n侠客行-曜投-1-刚刚好-0605\n同名\n没有这个户', rows)
assert.strictEqual(resolved.accounts.length, 2)
assert.strictEqual(resolved.accounts[1].advertiserId, '1866874744437063')
assert.strictEqual(resolved.unresolved.length, 2)
assert.strictEqual(resolved.unresolved[0].error, '有多个同名账户，请改用账户 ID')
const rawId = events.resolveAccounts('1999999999999999\n没有这个户', rows)
assert.strictEqual(rawId.accounts.length, 1)
assert.strictEqual(rawId.accounts[0].advertiserId, '1999999999999999')
assert.strictEqual(rawId.unresolved.length, 1)

const eventsList = [
  { name: '付费', eventId: '1' },
  { name: '付费ROI', eventId: '2' },
  { name: '付费 ROI', eventId: '3' },
]
assert.strictEqual(events.findEventByName(eventsList, '付费').eventId, '1')
assert.strictEqual(events.findEventByName(eventsList, '付费ROI').eventId, '2')
assert.strictEqual(events.findTargetEvent([{ eventType: 'active_pay', eventId: '8', name: '' }], '付费').eventId, '8')
assert.strictEqual(events.findTargetEvent([{ eventType: 'purchase_roi', eventId: '9', name: '付费ROI' }], '付费ROI').eventId, '9')
const mini = events.pickMiniApp([
  { instanceId: '1', appId: 'ttother', name: '别的', auditStatus: 'AUDIT_ACCEPTED' },
  { instanceId: '7602204508193917990', appId: 'ttc326b59b5c10bae401', name: '倾心书馆', auditStatus: 'AUDIT_ACCEPTED' },
])
assert.strictEqual(mini.instanceId, '7602204508193917990')
assert.strictEqual(events.pickEventAsset([{ assetId: '1', name: '别的' }, { assetId: '2', name: '倾心书馆' }]).assetId, '2')
assert.strictEqual(events.findEventByName([{ name: '付费 ROI', eventId: '3' }], '付费ROI').eventId, '3')
assert.ok(Array.isArray(events.listAccountOptions('__no_such_account__')))

console.log('oceanengine event ok')
