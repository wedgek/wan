/**
 * videoApiProfiles 单元烟测
 * 运行：node scripts/video-api-profiles.test.cjs
 */
const assert = require('assert')

process.env.VIDEO_API_PROVIDER = 'dmxapi'
delete require.cache[require.resolve('../services/videoApiProfiles')]
delete require.cache[require.resolve('../services/seedanceClient')]
const profiles = require('../services/videoApiProfiles')
const seedance = require('../services/seedanceClient')

function testInferProfiles() {
  assert.strictEqual(profiles.inferApiProfile('happyhorse-1.0-r2v'), 'happyhorse-r2v')
  assert.strictEqual(profiles.inferApiProfile('wan2.6-r2v'), 'wan-r2v')
  assert.strictEqual(profiles.inferApiProfile('wan2.1-i2v'), 'wan-i2v')
  assert.strictEqual(profiles.inferApiProfile('wan2.6-t2v'), 'wan-t2v')
  assert.strictEqual(profiles.inferApiProfile('doubao-seedance-2-0-260128'), 'seedance-multimodal')
  assert.strictEqual(profiles.inferApiProfile('viduq2-ctv'), 'vidu-ref')
  assert.strictEqual(profiles.inferApiProfile('viduq3-pro'), 'vidu-t2v')
  assert.strictEqual(profiles.inferApiProfile('MiniMax-Hailuo-2.3'), 'hailuo-i2v')
  assert.strictEqual(profiles.inferApiProfile('sora-2'), 'sora-flat')
  assert.strictEqual(profiles.inferApiProfile('happyhorse-1.0-r2v'), 'happyhorse-r2v')
  assert.strictEqual(profiles.isQueryModelId('seedance-2-0-get'), true)
}

function testResolveAndBuild() {
  const p = profiles.resolveVideoProfile('happyhorse-1.0-r2v')
  assert.strictEqual(p.id, 'happyhorse-r2v')
  const body = profiles.buildVideoTaskPayload(p, {
    model: 'happyhorse-1.0-r2v',
    prompt: '@图片1 产品展示',
    extra: { ratio: '9:16', duration: 5 },
    imageUrls: ['https://example.com/a.jpg'],
    videoUrls: [],
  })
  assert.ok(Array.isArray(body.input))
  assert.strictEqual(body.parameters.resolution, '720P')

  const wan = profiles.resolveVideoProfile('wan2.1-r2v')
  const wanBody = profiles.buildVideoTaskPayload(wan, {
    model: 'wan2.1-r2v',
    prompt: 'test',
    extra: {},
    imageUrls: ['https://example.com/a.jpg'],
    videoUrls: ['https://example.com/v.mp4'],
  })
  assert.ok(wanBody.input && typeof wanBody.input === 'object' && !Array.isArray(wanBody.input))
  assert.strictEqual(profiles.resolveQueryModel(wan, 'wan2.1-r2v'), 'wan2.1-get')
  assert.strictEqual(profiles.resolveQueryModel(wan, 'wan2.6-r2v'), 'wan2.6-get')

  const wanI2v = profiles.resolveVideoProfile('wan2.1-i2v')
  assert.strictEqual(wanI2v.id, 'wan-i2v')
  assert.strictEqual(profiles.resolveQueryModel(wanI2v, 'wan2.1-i2v'), 'wan2.1-get')

  const vidu = profiles.resolveVideoProfile('viduq3-pro')
  const viduBody = profiles.buildVideoTaskPayload(vidu, {
    model: 'viduq3-pro',
    prompt: '小猫奔跑',
    extra: { duration: 8 },
    imageUrls: [],
    videoUrls: [],
  })
  assert.strictEqual(typeof viduBody.input, 'string')
  assert.strictEqual(viduBody.duration, 8)
}

function testPreflight() {
  const p = profiles.resolveVideoProfile('happyhorse-1.0-r2v')
  const bad = profiles.preflightVideoTask(p, {
    prompt: 'test',
    imageUrls: [],
    videoUrls: ['https://example.com/v.mp4'],
    extra: {},
  })
  assert.strictEqual(bad.ok, false)

  const good = profiles.preflightVideoTask(p, {
    prompt: 'test',
    imageUrls: ['https://example.com/a.jpg'],
    videoUrls: [],
    extra: { duration: 5 },
  })
  assert.strictEqual(good.ok, true)

  const kling = profiles.resolveVideoProfile('kling-v3')
  assert.deepStrictEqual(kling.constraints.durationChoices, [5, 10])
  assert.strictEqual(profiles.resolveQueryModel(kling, 'kling-v3'), 'kling-v3-get')
  const klingCaps = profiles.mergeConstraints(kling)
  assert.strictEqual(klingCaps.supportsReferenceVideo, false)
  assert.strictEqual(klingCaps.maxRefVideos, 0)
  const badKlingDur = profiles.preflightVideoTask(kling, {
    prompt: 'test',
    imageUrls: [],
    videoUrls: [],
    extra: { duration: 4 },
  })
  assert.strictEqual(badKlingDur.ok, false)
  const badKlingVid = profiles.preflightVideoTask(kling, {
    prompt: 'test',
    imageUrls: ['https://example.com/a.jpg'],
    videoUrls: ['https://example.com/ref.mp4'],
    extra: { duration: 5 },
  })
  assert.strictEqual(badKlingVid.ok, false)
  assert.ok(badKlingVid.message.includes('不支持参考视频'))
}

function testLegacyBuildCreateTaskBody() {
  const body = seedance.buildCreateTaskBody({
    model: 'kling-v3-video-generation',
    prompt: 'test',
    extra: { duration: 5 },
    imageUrls: [],
    videoUrls: [],
  })
  assert.ok(body.input && typeof body.input === 'object')
}

function run() {
  testInferProfiles()
  testResolveAndBuild()
  testPreflight()
  testLegacyBuildCreateTaskBody()
  console.log('[video-api-profiles.test] OK')
}

run()
