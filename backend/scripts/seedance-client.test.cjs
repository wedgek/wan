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

  const dmxPayload = dmx.payloadForProvider(body, 'dmxapi')
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

function testWanTaskStatusParsing() {
  const mockRemote = {
    output: [
      {
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              task_id: '6454ca2a-e80c-414f-a75e-877abcc443c1',
              task_status: 'SUCCEEDED',
              video_url: 'https://example.com/wan.mp4',
            }),
          },
        ],
      },
    ],
  }
  const update = dmx.mapRemoteToJobUpdate(mockRemote)
  assert.strictEqual(update.status, 'succeeded')
  assert.strictEqual(update.resultUrl, 'https://example.com/wan.mp4')

  const running = dmx.mapRemoteToJobUpdate({
    output: [{ content: [{ text: JSON.stringify({ task_status: 'RUNNING', task_id: 'x' }) }] }],
  })
  assert.strictEqual(running.status, 'processing')
}

function testWanI2vT2vBodies() {
  const i2v = dmx.buildCreateTaskBody({
    model: 'wan2.1-i2v',
    prompt: '首帧图动起来',
    extra: { ratio: '9:16', duration: 4, resolution: '720p' },
    imageUrls: ['https://example.com/frame.jpg'],
    videoUrls: [],
  })
  assert.strictEqual(i2v.model, 'wan2.1-i2v')
  assert.strictEqual(i2v.input.img_url, 'https://example.com/frame.jpg')
  assert.strictEqual(i2v.parameters.resolution, '720P')

  const t2v = dmx.buildCreateTaskBody({
    model: 'wan2.6-t2v',
    prompt: '小猫在悬崖上',
    extra: { ratio: '16:9', duration: 5, resolution: '1080p' },
    imageUrls: [],
    videoUrls: [],
  })
  assert.strictEqual(t2v.model, 'wan2.6-t2v')
  assert.strictEqual(t2v.input.prompt, '小猫在悬崖上')
  assert.strictEqual(t2v.parameters.size, '1920*1080')
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

  const payload = dmx.payloadForProvider(body, 'dmxapi')
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

function testKlingV3RejectsRefVideo() {
  assert.throws(
    () =>
      dmx.buildCreateTaskBody({
        model: 'kling-v3-video-generation',
        prompt: '与 @视频1 相同镜头，手持 @图片1',
        extra: { duration: 5, ratio: '9:16' },
        imageUrls: ['https://example.com/product.jpg'],
        videoUrls: ['https://example.com/ref.mp4'],
      }),
    (e) => e.code === 'E_ARK_PAYLOAD' && /不支持参考视频/.test(e.message),
  )
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
  assert.strictEqual(body.input.prompt, '一只猫在奔跑')
  assert.strictEqual(body.input.multi_shot, false)
  assert.strictEqual(body.parameters.aspect_ratio, '16:9')
  assert.strictEqual(body.parameters.duration, 10)
}

function testWanR2vMultimodalBody() {
  const body = dmx.buildCreateTaskBody({
    model: 'wan2.1-r2v',
    prompt: '与 @视频1 相同镜头，手持 @图片1',
    extra: { ratio: '9:16', duration: 4, resolution: '720p' },
    imageUrls: ['https://example.com/product.jpg'],
    videoUrls: ['https://example.com/ref.mp4'],
  })
  assert.strictEqual(body.model, 'wan2.1-r2v')
  assert.ok(body.input && typeof body.input === 'object' && !Array.isArray(body.input))
  assert.strictEqual(typeof body.input.prompt, 'string')
  assert.ok(body.input.prompt.includes('character1') || body.input.prompt.includes('character2'))
  assert.deepStrictEqual(body.input.reference_urls, [
    'https://example.com/product.jpg',
    'https://example.com/ref.mp4',
  ])
  assert.strictEqual(body.parameters.size, '720*1280')
  assert.strictEqual(body.parameters.duration, 4)
  assert.strictEqual(body.content, undefined)

  const payload = dmx.payloadForProvider(body, 'dmxapi')
  assert.deepStrictEqual(payload.input, body.input)
  assert.ok(!Array.isArray(payload.input))
  assert.strictEqual(payload.parameters.size, '720*1280')
}

function testHappyHorseR2vBody() {
  assert.strictEqual(dmx.isHappyHorseR2vModel('happyhorse-1.0-r2v'), true)
  assert.strictEqual(dmx.isWanR2vModel('happyhorse-1.0-r2v'), false)
  assert.strictEqual(dmx.resolveDmxapiQueryModel('happyhorse-1.0-r2v'), 'happyhorse-get')
  assert.strictEqual(dmx.resolveDmxapiQueryModel('wan2.6-r2v'), 'wan2.6-get')
  assert.strictEqual(dmx.resolveDmxapiQueryModel('wan2.1-r2v'), 'wan2.1-get')
  assert.strictEqual(dmx.resolveDmxapiQueryModel('wan2.1-i2v'), 'wan2.1-get')
  assert.strictEqual(dmx.resolveDmxapiQueryModel('wan2.6-t2v'), 'wan2.6-get')

  const body = dmx.buildCreateTaskBody({
    model: 'happyhorse-1.0-r2v',
    prompt: '与 @图片1 相同产品，在粉色地板上',
    extra: { ratio: '9:16', duration: 4, resolution: '720p' },
    imageUrls: ['https://example.com/product.jpg'],
    videoUrls: [],
  })
  assert.strictEqual(body.model, 'happyhorse-1.0-r2v')
  assert.ok(Array.isArray(body.input))
  assert.strictEqual(body.input.length, 1)
  assert.ok(body.input[0].prompt.includes('[Image 1]'))
  assert.deepStrictEqual(body.input[0].media, [
    { type: 'reference_image', url: 'https://example.com/product.jpg' },
  ])
  assert.strictEqual(body.parameters.resolution, '720P')
  assert.strictEqual(body.parameters.ratio, '9:16')
  assert.strictEqual(body.parameters.duration, 4)

  const payload = dmx.payloadForProvider(body, 'dmxapi')
  assert.ok(Array.isArray(payload.input))
  assert.strictEqual(payload.input[0].media[0].type, 'reference_image')

  assert.throws(() => {
    dmx.buildCreateTaskBody({
      model: 'happyhorse-1.0-r2v',
      prompt: 'test',
      extra: {},
      imageUrls: ['https://example.com/a.jpg'],
      videoUrls: ['https://example.com/ref.mp4'],
    })
  }, /不支持参考视频/)
}

function testViduAndSoraBodies() {
  const vidu = dmx.buildCreateTaskBody({
    model: 'viduq3-pro',
    prompt: '小猫在沙滩奔跑',
    extra: { duration: 8, ratio: '4:3', resolution: '1080p' },
    imageUrls: [],
    videoUrls: [],
  })
  assert.strictEqual(vidu.model, 'viduq3-pro')
  assert.strictEqual(typeof vidu.input, 'string')
  assert.strictEqual(vidu.duration, 8)

  const head = dmx.buildCreateTaskBody({
    model: 'viduq2-pro',
    prompt: '首尾帧过渡',
    extra: { duration: 5 },
    imageUrls: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
    videoUrls: [],
  })
  assert.ok(Array.isArray(head.images))
  assert.strictEqual(head.images.length, 2)

  const sora = dmx.buildCreateTaskBody({
    model: 'sora-2',
    prompt: '市场里的对话',
    extra: { duration: 4, ratio: '9:16' },
    imageUrls: [],
    videoUrls: [],
  })
  assert.strictEqual(sora.model, 'sora-2')
  assert.strictEqual(typeof sora.input, 'string')
  assert.ok(sora.seconds)
}

function run() {
  testBuildBodyMultimodal()
  testFirstLastFrameArkMode()
  testDmxapiResponseParsing()
  testDmxapiPendingStatus()
  testWanTaskStatusParsing()
  testArkResponseParsing()
  testPickTaskIdDmxCreate()
  testKlingActionControlBody()
  testKlingImage2VideoBody()
  testKlingV3RejectsRefVideo()
  testKlingV3TextOnlyBody()
  testWanR2vMultimodalBody()
  testWanI2vT2vBodies()
  testHappyHorseR2vBody()
  testViduAndSoraBodies()
  console.log('[seedance-client.test] OK')
}

run()
