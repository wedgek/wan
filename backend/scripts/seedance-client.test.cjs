/**
 * seedanceClient 单元烟测（不调用真实 API）
 * 运行：npm run test:seedance
 */
const assert = require('assert')

process.env.VIDEO_API_PROVIDER = 'dmxapi'
delete require.cache[require.resolve('../services/seedanceClient')]
const dmx = require('../services/seedanceClient')

process.env.VIDEO_API_PROVIDER = 'ark'
delete require.cache[require.resolve('../services/seedanceClient')]
const ark = require('../services/seedanceClient')

function testBuildBodyMultimodal() {
  const body = dmx.buildCreateTaskBody({
    model: 'doubao-seedance-2-0-260128',
    prompt: '测试 @图片1 与 @视频1',
    extra: { duration: 8, ratio: '16:9' },
    imageUrls: ['https://example.com/a.jpg'],
    videoUrls: ['https://example.com/b.mp4'],
  })
  assert.strictEqual(body.model, 'doubao-seedance-2-0-260128')
  assert.strictEqual(body.duration, 8)
  assert.ok(Array.isArray(body.content))
  assert.strictEqual(body.content[0].type, 'text')
  assert.ok(body.content[0].text.includes('图片1'))
  assert.strictEqual(body.content[1].role, 'reference_image')
  assert.strictEqual(body.content[2].role, 'reference_video')

  const dmxPayload = dmx.payloadForProvider(body)
  assert.ok(Array.isArray(dmxPayload.input))
  assert.strictEqual(dmxPayload.input.length, body.content.length)
  assert.strictEqual(dmxPayload.content, undefined)
}

function testFirstLastFrameArkMode() {
  process.env.ARK_VIDEO_CONTENT_MODE = 'auto'
  delete require.cache[require.resolve('../services/seedanceClient')]
  const client = require('../services/seedanceClient')
  const body = client.buildCreateTaskBody({
    model: 'ep-test',
    prompt: '首尾帧',
    extra: {},
    imageUrls: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
    videoUrls: [],
  })
  assert.strictEqual(body.content[1].role, 'first_frame')
  assert.strictEqual(body.content[2].role, 'last_frame')
  delete process.env.ARK_VIDEO_CONTENT_MODE
}

function testDmxapiResponseParsing() {
  const mockRemote = {
    request_id: 'cgt-test-001',
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              content: { video_url: 'https://example.com/out.mp4' },
              id: 'cgt-test-001',
              model: 'doubao-seedance-2-0-260128',
              status: 'succeeded',
            }),
          },
        ],
      },
    ],
  }
  const update = dmx.mapRemoteToJobUpdate(mockRemote)
  assert.strictEqual(update.status, 'succeeded')
  assert.strictEqual(update.resultUrl, 'https://example.com/out.mp4')
  assert.strictEqual(update.errorMessage, '')
}

function testDmxapiPendingStatus() {
  const mockRemote = {
    output: [
      {
        content: [
          {
            text: JSON.stringify({ status: 'running', id: 'cgt-x' }),
          },
        ],
      },
    ],
  }
  const update = dmx.mapRemoteToJobUpdate(mockRemote)
  assert.strictEqual(update.status, 'processing')
}

function testArkResponseParsing() {
  const mockRemote = {
    id: 'task-ark-1',
    status: 'succeeded',
    content: { video_url: 'https://ark.example.com/v.mp4' },
  }
  const update = ark.mapRemoteToJobUpdate(mockRemote)
  assert.strictEqual(update.status, 'succeeded')
  assert.strictEqual(update.resultUrl, 'https://ark.example.com/v.mp4')
  assert.strictEqual(ark.pickTaskId(mockRemote), 'task-ark-1')
}

function testPickTaskIdDmxCreate() {
  assert.strictEqual(dmx.pickTaskId({ id: 'cgt-20260402220852-nq4wx' }), 'cgt-20260402220852-nq4wx')
}

function testKlingActionControlBody() {
  const body = dmx.buildCreateTaskBody({
    model: 'kling-v2-6',
    prompt: '在舞台上表演',
    extra: { duration: 10, ratio: '9:16' },
    imageUrls: ['https://example.com/person.jpg'],
    videoUrls: ['https://example.com/dance.mp4'],
  })
  assert.strictEqual(body.model, 'kling-v2-6')
  assert.strictEqual(body.action_control, true)
  assert.strictEqual(body.video_url, 'https://example.com/dance.mp4')
  assert.strictEqual(body.image, 'https://example.com/person.jpg')
  assert.strictEqual(body.aspect_ratio, '9:16')
  assert.strictEqual(body.duration, 10)
  assert.strictEqual(typeof body.input, 'string')

  const payload = dmx.payloadForProvider(body)
  assert.strictEqual(payload.input, body.input)
  assert.strictEqual(payload.content, undefined)
}

function testKlingImage2VideoBody() {
  const body = dmx.buildCreateTaskBody({
    model: 'kling-v2-6',
    prompt: '宇航员站起身走了',
    extra: {},
    imageUrls: ['https://example.com/frame.jpg'],
    videoUrls: [],
  })
  assert.strictEqual(body.model, 'kling-v2-6-image2video')
  assert.strictEqual(body.image, 'https://example.com/frame.jpg')
  assert.strictEqual(body.action_control, undefined)
}

function testKlingV3MultimodalBody() {
  const body = dmx.buildCreateTaskBody({
    model: 'kling-v3-video-generation',
    prompt: '与 @视频1 相同镜头，手持 @图片1',
    extra: { duration: 5, ratio: '9:16' },
    imageUrls: ['https://example.com/product.jpg'],
    videoUrls: ['https://example.com/ref.mp4'],
  })
  assert.strictEqual(body.model, 'kling-v3-video-generation')
  assert.ok(body.input && typeof body.input === 'object' && !Array.isArray(body.input))
  assert.strictEqual(typeof body.input, 'object')
  assert.ok(Array.isArray(body.input.media))
  assert.strictEqual(body.input.media[0].type, 'first_frame')
  assert.strictEqual(body.input.media[1].type, 'reference_video')
  assert.ok(Array.isArray(body.input.multi_prompt))
  assert.ok(body.input.multi_prompt[0].prompt.includes('视频1') || body.input.multi_prompt[0].prompt.includes('图片1'))
  assert.strictEqual(body.input.multi_prompt[0].duration, 5)
  assert.strictEqual(body.input.aspect_ratio, '9:16')
  assert.strictEqual(body.content, undefined)

  const payload = dmx.payloadForProvider(body)
  assert.deepStrictEqual(payload.input, body.input)
  assert.strictEqual(typeof payload.input, 'object')
}

function testKlingV3TextOnlyBody() {
  const body = dmx.buildCreateTaskBody({
    model: 'kling-v3',
    prompt: '一只猫在奔跑',
    extra: { ratio: '16:9', duration: 10 },
    imageUrls: [],
    videoUrls: [],
  })
  assert.strictEqual(body.model, 'kling-v3')
  assert.ok(body.input && typeof body.input === 'object')
  assert.strictEqual(body.input.media, undefined)
  assert.strictEqual(body.input.multi_prompt[0].prompt, '一只猫在奔跑')
  assert.strictEqual(body.input.multi_prompt[0].duration, 10)
}

function run() {
  testBuildBodyMultimodal()
  testFirstLastFrameArkMode()
  testDmxapiResponseParsing()
  testDmxapiPendingStatus()
  testArkResponseParsing()
  testPickTaskIdDmxCreate()
  testKlingActionControlBody()
  testKlingImage2VideoBody()
  testKlingV3MultimodalBody()
  testKlingV3TextOnlyBody()
  console.log('[seedance-client.test] OK')
}

run()
