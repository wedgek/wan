/**
 * 从视频 API 拉取任务状态；成功时先落库官方 URL，TOS 转存在后台异步完成。
 */
const seedance = require('./seedanceClient')
const { getProfileById } = require('./videoApiProfiles')
const { maybeMirrorSeedanceVideoToTos } = require('./videoResultTosMirror')
const kling = require('./klingVideoClient')

function resolveExternalTaskId(externalTaskId, requestPayloadJson = '', apiProfile = '') {
  const id = String(externalTaskId || '').trim()
  const profileId = String(apiProfile || '').trim()
  if (!id || !profileId.startsWith('kling') || !requestPayloadJson) return id
  try {
    const stored = JSON.parse(requestPayloadJson)
    if (stored?.createRemote) {
      const fixed = kling.pickKlingTaskId(stored.createRemote)
      if (fixed && fixed !== id) return fixed
    }
  } catch (_) {
    /* ignore */
  }
  return id
}

/**
 * @param {string} externalTaskId
 * @param {number} jobId video_jobs.id（转存 TOS 时用于 objectKey 与并发去重）
 * @param {string} [createModelId] 创建任务时的 api_model_id
 * @param {string} [apiProfile] 任务 api_profile
 * @param {string} [requestPayloadJson] video_jobs.request_payload，用于修正历史 UUID task id
 */
async function pullArkJobStateAndStableResultUrl(
  externalTaskId,
  jobId,
  createModelId = '',
  apiProfile = '',
  requestPayloadJson = '',
) {
  const profileId = String(apiProfile || '').trim()
  const taskId = resolveExternalTaskId(externalTaskId, requestPayloadJson, profileId)
  if (taskId !== externalTaskId && jobId) {
    try {
      const db = require('../db').getDb()
      db.prepare(`UPDATE video_jobs SET external_task_id = ?, updated_at = datetime('now') WHERE id = ?`).run(
        taskId,
        jobId,
      )
      console.info('[videoJobArkSync] repaired kling external_task_id', jobId, externalTaskId, '->', taskId)
    } catch (e) {
      console.error('[videoJobArkSync] repair external_task_id', jobId, e.message)
    }
  }
  const remote = await seedance.getContentsGenerationTask(taskId, createModelId, profileId)
  let { status, resultUrl, errorMessage } = seedance.mapRemoteToJobUpdate(remote, profileId)

  if (status === 'succeeded' && resultUrl) {
    const officialUrl = resultUrl
    setImmediate(() => {
      maybeMirrorSeedanceVideoToTos(officialUrl, { jobId })
        .then((mirrored) => {
          if (!mirrored || mirrored === officialUrl) return
          try {
            const db = require('../db').getDb()
            db.prepare(
              `UPDATE video_jobs SET result_url = ?, updated_at = datetime('now') WHERE id = ?`,
            ).run(mirrored, jobId)
            db.prepare(
              `UPDATE video_chat_messages SET result_url = ? WHERE video_job_id = ?`,
            ).run(mirrored, jobId)
          } catch (e) {
            console.error('[videoJobArkSync] mirror update', jobId, e.message)
          }
        })
        .catch((e) => {
          console.error('[videoJobArkSync] mirror', jobId, e.message)
        })
    })
  }

  return { status, resultUrl, errorMessage }
}

/** 将 video_jobs 状态同步到关联的对话助手消息 */
function syncAssistantMessagesForJob(dbi, jobId) {
  const job = dbi
    .prepare(`SELECT status, result_url, error_message FROM video_jobs WHERE id = ?`)
    .get(jobId)
  if (!job) return
  dbi
    .prepare(
      `UPDATE video_chat_messages SET status = ?, result_url = ?, error_message = ? WHERE video_job_id = ?`,
    )
    .run(job.status, job.result_url || '', job.error_message || '', jobId)
}

module.exports = {
  pullArkJobStateAndStableResultUrl,
  syncAssistantMessagesForJob,
  getProfileById,
}
