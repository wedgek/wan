/**
 * klingVideoClient 单元烟测
 * 运行：node scripts/kling-video-client.test.cjs
 */
const assert = require('assert')

process.env.VIDEO_API_PROVIDER = 'dmxapi'
delete require.cache[require.resolve('../services/seedanceClient')]
delete require.cache[require.resolve('../services/klingVideoClient')]
delete require.cache[require.resolve('../services/videoApiTransport')]
delete require.cache[require.resolve('../services/videoApiProfiles')]

const kling = require('../services/klingVideoClient')
const transport = require('../services/videoApiTransport')
const profiles = require('../services/videoApiProfiles')
const dmx = require('../services/seedanceClient')

/** 官方 V3 文生视频创建响应（doc.dmxapi.cn） */
const V3_CREATE_REMOTE = {
  request_id: '3a1e5556-3d19-955b-80e5-fd25541d47cf',
  output: [
    {
      type: 'message',
      content: [
        {
          type: 'output_text',
          text: '{"task_id":"4b117331-32e6-4c30-af95-e045956a89fe","task_status":"PENDING"}',
        },
      ],
    },
  ],
}

function testPickKlingTaskId() {
  assert.strictEqual(kling.pickKlingTaskId(V3_CREATE_REMOTE), '4b117331-32e6-4c30-af95-e045956a89fe')

  assert.strictEqual(
    kling.pickKlingTaskId({
      request_id: '8e8c4c70-d9bc-4a34-8cae-34edca295a1b',
      data: { task_id: '842081252995395657', task_status: 'submitted' },
    }),
    '842081252995395657',
  )
  assert.strictEqual(kling.pickKlingTaskId({ request_id: 'uuid-only' }), '')
  assert.strictEqual(
    kling.pickKlingTaskId({
      request_id: '3a1e5556-3d19-955b-80e5-fd25541d47cf',
      data: { id: '3a1e5556-3d19-955b-80e5-fd25541d47cf' },
    }),
    '',
  )
}

function testKlingV3GetStatuses() {
  const running = kling.mapKlingRemoteToJobUpdate({
    output: [
      {
        content: [
          {
            text: JSON.stringify({
              task_id: '4b117331-32e6-4c30-af95-e045956a89fe',
              task_status: 'RUNNING',
            }),
          },
        ],
      },
    ],
  })
  assert.strictEqual(running.status, 'processing')

  const done = kling.mapKlingRemoteToJobUpdate({
    output: [
      {
        content: [
          {
            text: JSON.stringify({
              task_id: '4b117331-32e6-4c30-af95-e045956a89fe',
              task_status: 'SUCCEEDED',
              video_url: 'https://v4-fdl.example.com/out.mp4?cacheKey=1',
            }),
          },
        ],
      },
    ],
  })
  assert.strictEqual(done.status, 'succeeded')
  assert.ok(done.resultUrl.startsWith('https://v4-fdl.example.com/out.mp4'))
}

function testKlingGetCompletedV2Stream() {
  const mapped = kling.mapKlingRemoteToJobUpdate({
    response: {
      status: 'completed',
      output: [
        {
          content: [
            {
              text: '任务ID: 842081252995395657\nhttps://v1.example.com/out.mp4?cache=1',
            },
          ],
        },
      ],
    },
  })
  assert.strictEqual(mapped.status, 'succeeded')
  assert.ok(mapped.resultUrl.startsWith('https://v1.example.com/out.mp4'))
}

function testKlingProcessingV2() {
  const mapped = kling.mapKlingRemoteToJobUpdate({
    data: { task_status: 'processing', task_id: '842081252995395657' },
  })
  assert.strictEqual(mapped.status, 'processing')
  assert.strictEqual(mapped.resultUrl, '')
}

function testTransportPickAndMap() {
  const profile = profiles.getProfileById('kling-v3')
  const tid = transport.pickTaskIdForProfile(profile, V3_CREATE_REMOTE)
  assert.strictEqual(tid, '4b117331-32e6-4c30-af95-e045956a89fe')

  const upd = transport.mapRemoteToJobUpdateForProfile(profile, {
    output: [
      {
        content: [
          {
            text: JSON.stringify({
              task_status: 'SUCCEEDED',
              video_url: 'https://cdn.example.com/kling.mp4',
            }),
          },
        ],
      },
    ],
  })
  assert.strictEqual(upd.status, 'succeeded')
  assert.strictEqual(upd.resultUrl, 'https://cdn.example.com/kling.mp4')
}

function testSeedanceAndHappyhorseUnchanged() {
  const seedanceRemote = {
    output: [
      {
        content: [
          {
            text: JSON.stringify({
              task_id: 'cgt-1',
              task_status: 'SUCCEEDED',
              video_url: 'https://example.com/seedance.mp4',
            }),
          },
        ],
      },
    ],
  }
  const seedanceUpd = dmx.mapRemoteToJobUpdate(seedanceRemote, 'seedance-multimodal')
  assert.strictEqual(seedanceUpd.status, 'succeeded')
  assert.strictEqual(seedanceUpd.resultUrl, 'https://example.com/seedance.mp4')

  const hhRemote = {
    output: [{ content: [{ text: JSON.stringify({ task_status: 'SUCCEEDED', video_url: 'https://example.com/hh.mp4' }) }] }],
  }
  const hhUpd = dmx.mapRemoteToJobUpdate(hhRemote, 'happyhorse-r2v')
  assert.strictEqual(hhUpd.status, 'succeeded')
  assert.strictEqual(hhUpd.resultUrl, 'https://example.com/hh.mp4')
}

function testKlingV3GetFailedHttp400() {
  const mapped = kling.mapKlingRemoteToJobUpdate({
    output: [
      {
        content: [
          {
            text: JSON.stringify({
              task_id: 'fa9456b5-f17b-41f0-bc3e-ac625eb8c626',
              task_status: 'FAILED',
              task_status_msg: 'task status: FAILED',
            }),
          },
        ],
      },
    ],
  })
  assert.strictEqual(mapped.status, 'failed')
  assert.ok(mapped.errorMessage.includes('FAILED'))
}

function run() {
  testPickKlingTaskId()
  testKlingV3GetStatuses()
  testKlingV3GetFailedHttp400()
  testKlingGetCompletedV2Stream()
  testKlingProcessingV2()
  testTransportPickAndMap()
  testSeedanceAndHappyhorseUnchanged()
  console.log('[kling-video-client.test] OK')
}

run()
