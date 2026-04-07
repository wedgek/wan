/**
 * 从方舟拉取任务状态；成片成功时可选转存 TOS（见 videoResultTosMirror）。
 */
const seedance = require('./seedanceClient')
const { maybeMirrorSeedanceVideoToTos } = require('./videoResultTosMirror')

/**
 * @param {string} externalTaskId
 * @param {number} jobId video_jobs.id
 */
async function pullArkJobStateAndStableResultUrl(externalTaskId, jobId) {
  const remote = await seedance.getContentsGenerationTask(externalTaskId)
  let { status, resultUrl, errorMessage } = seedance.mapRemoteToJobUpdate(remote)

  if (status === 'succeeded' && resultUrl) {
    resultUrl = await maybeMirrorSeedanceVideoToTos(resultUrl, { jobId })
  }

  return { status, resultUrl, errorMessage }
}

module.exports = {
  pullArkJobStateAndStableResultUrl,
}
