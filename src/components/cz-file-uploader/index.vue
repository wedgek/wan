<template>
  <div
    class="cz-file-uploader"
    :class="[`is-${status}`, { 'is-dragover': isDragover }]"
    @dragover.prevent="onDragover"
    @dragleave.prevent="isDragover = false"
    @drop.prevent="onDrop"
  >
    <input ref="inputRef" type="file" :accept="accept" @change="onChange" />

    <!-- 待上传 -->
    <template v-if="status === 'idle'">
      <div class="dropzone" @click="inputRef?.click()">
        <div class="dropzone-icon"><el-icon><UploadFilled /></el-icon></div>
        <div class="dropzone-text">
          <p>{{ placeholder }}</p>
          <span>支持 {{ acceptText }}，最大 {{ maxSize }}MB</span>
        </div>
      </div>
    </template>

    <!-- 上传中 -->
    <template v-else-if="status === 'uploading'">
      <div class="upload-progress">
        <el-icon class="file-icon"><component :is="fileIcon" /></el-icon>
        <div class="progress-content">
          <span class="file-name" :title="fileName">{{ fileName }}</span>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: progress + '%' }"></div>
          </div>
        </div>
        <span class="progress-num">{{ progress }}%</span>
      </div>
    </template>

    <!-- 上传成功 -->
    <template v-else-if="status === 'success'">
      <div class="upload-result">
        <el-icon class="file-icon"><component :is="fileIcon" /></el-icon>
        <div class="result-content">
          <span class="file-name" :title="fileName">{{ fileName }}</span>
          <span class="file-meta">{{ fileSizeText }} · 上传成功</span>
        </div>
        <el-icon class="remove-btn" @click="reset"><Close /></el-icon>
      </div>
    </template>

    <!-- 上传失败 -->
    <template v-else>
      <div class="upload-error">
        <el-icon class="file-icon"><WarningFilled /></el-icon>
        <div class="error-content">
          <span class="file-name" :title="fileName">{{ fileName }}</span>
          <span class="error-msg">{{ errorMsg }}</span>
        </div>
        <div class="error-actions">
          <el-button type="primary" link size="small" @click="retry">重试</el-button>
          <el-button type="info" link size="small" @click="reset">取消</el-button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, shallowRef } from 'vue'
import { ElMessage } from 'element-plus'
import { 
  UploadFilled, Close, WarningFilled, Document, Picture, VideoPlay, 
  Cellphone, Headset, FolderOpened, Tickets, Reading
} from '@element-plus/icons-vue'
import { uploadWithProgress, getFileExt } from '@/request/oss'

const props = defineProps({
  modelValue: { type: String, default: '' },
  accept: { type: String, default: '*' },
  maxSize: { type: Number, default: 100 },
  placeholder: { type: String, default: '点击或拖拽文件上传' },
  disabled: { type: Boolean, default: false },
  dir: { type: String, default: '' },
  maxRetry: { type: Number, default: 3 }
})

const emit = defineEmits(['update:modelValue', 'success', 'error'])

const inputRef = ref(null)
const isDragover = ref(false)
const status = ref(props.modelValue ? 'success' : 'idle')
const progress = ref(0)
const fileName = ref(props.modelValue ? props.modelValue.split('/').pop() || '已上传文件' : '')
const fileSize = ref(0)
const errorMsg = ref('')
const retryCount = ref(0)
const currentFile = shallowRef(null)

const acceptText = computed(() => props.accept === '*' ? '所有文件' : props.accept.replace(/\./g, '').toUpperCase())

const fileSizeText = computed(() => {
  if (!fileSize.value) return ''
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(fileSize.value) / Math.log(k))
  return `${(fileSize.value / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
})

// 文件图标映射
const FILE_ICON_MAP = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'],
  video: ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm', 'm4v'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a'],
  app: ['apk', 'ipa', 'exe', 'dmg', 'msi', 'deb', 'rpm'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'],
  doc: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md']
}

const fileIcon = computed(() => {
  if (!currentFile.value) return Document
  const ext = getFileExt(currentFile.value)
  if (FILE_ICON_MAP.image.includes(ext)) return Picture
  if (FILE_ICON_MAP.video.includes(ext)) return VideoPlay
  if (FILE_ICON_MAP.audio.includes(ext)) return Headset
  if (FILE_ICON_MAP.app.includes(ext)) return Cellphone
  if (FILE_ICON_MAP.archive.includes(ext)) return FolderOpened
  if (FILE_ICON_MAP.doc.includes(ext)) return Reading
  return Tickets
})

const onDragover = () => {
  if (!props.disabled && status.value !== 'uploading') isDragover.value = true
}

const onDrop = (e) => {
  isDragover.value = false
  if (props.disabled || status.value === 'uploading') return
  const file = e.dataTransfer?.files?.[0]
  if (file) handleFile(file)
}

const onChange = (e) => {
  const file = e.target?.files?.[0]
  if (file) handleFile(file)
  if (inputRef.value) inputRef.value.value = ''
}

const handleFile = (file) => {
  // 格式校验
  if (props.accept !== '*') {
    const ext = '.' + getFileExt(file)
    if (!props.accept.toLowerCase().split(',').map(s => s.trim()).includes(ext)) {
      return ElMessage(`仅支持 ${acceptText.value} 格式`)
    }
  }
  // 大小校验
  if (file.size / 1024 / 1024 > props.maxSize) {
    return ElMessage(`文件大小不能超过 ${props.maxSize}MB`)
  }

  currentFile.value = file
  fileName.value = file.name
  fileSize.value = file.size
  retryCount.value = 0
  upload(file)
}

const upload = async (file) => {
  status.value = 'uploading'
  progress.value = 0

  try {
    const url = await uploadWithProgress(file, {
      dir: props.dir || undefined,
      onProgress: (p) => { progress.value = p }
    })
    status.value = 'success'
    emit('update:modelValue', url)
    emit('success', { url, file })
  } catch (e) {
    status.value = 'error'
    const msg = e?.message || ''
    if (msg.includes('network') || msg.includes('XHR') || msg.includes('connected')) {
      errorMsg.value = '网络异常，请重试'
    } else if (msg.includes('timeout')) {
      errorMsg.value = '上传超时'
    } else {
      errorMsg.value = '上传失败'
    }
    emit('error', e)
  }
}

const retry = () => {
  if (!currentFile.value || retryCount.value >= props.maxRetry) {
    return ElMessage('已达最大重试次数')
  }
  retryCount.value++
  upload(currentFile.value)
}

const reset = () => {
  status.value = 'idle'
  progress.value = 0
  fileName.value = ''
  fileSize.value = 0
  errorMsg.value = ''
  currentFile.value = null
  emit('update:modelValue', '')
}
</script>

<style lang="scss" scoped>
.cz-file-uploader {
  width: 100%;
  border: 1px dashed #dcdfe6;
  border-radius: 8px;
  background: #fafbfc;
  transition: border-color 0.2s, background 0.2s;

  > input { display: none; }

  &.is-idle:hover {
    border-color: $primary-color;
    background: #f5f9ff;
  }

  &.is-dragover {
    border-color: $primary-color;
    background: #ecf5ff;
  }

  &.is-success {
    border: 1px solid #c2e7b0;
    background: #f0f9eb;
  }

  &.is-error {
    border: 1px solid #fab6b6;
    background: #fef0f0;
  }
}

.dropzone {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px;
  cursor: pointer;

  &-icon {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    background: #e6f0ff;
    display: flex;
    align-items: center;
    justify-content: center;
    color: $primary-color;
    font-size: 20px;
    flex-shrink: 0;
  }

  &-text {
    p {
      margin: 0 0 2px;
      font-size: 14px;
      font-weight: 500;
      color: #303133;
    }
    span {
      font-size: 12px;
      color: #909399;
    }
  }
}

.upload-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;

  .file-icon {
    font-size: 22px;
    color: $primary-color;
    flex-shrink: 0;
  }

  .progress-content {
    flex: 1;
    min-width: 0;
  }

  .file-name {
    display: block;
    font-size: 13px;
    color: #303133;
    margin-bottom: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .progress-bar {
    height: 4px;
    background: #e4e7ed;
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: $primary-color;
    border-radius: 2px;
    transition: width 0.1s;
  }

  .progress-num {
    font-size: 13px;
    font-weight: 500;
    color: $primary-color;
    min-width: 36px;
    text-align: right;
  }
}

.upload-result {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;

  .file-icon {
    font-size: 22px;
    color: var(--el-color-success);
    flex-shrink: 0;
  }

  .result-content {
    flex: 1;
    min-width: 0;
  }

  .file-name {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: #303133;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-meta {
    font-size: 12px;
    color: #67c23a;
  }

  .remove-btn {
    font-size: 16px;
    color: #c0c4cc;
    cursor: pointer;
    &:hover { color: var(--el-color-danger); }
  }
}

.upload-error {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;

  .file-icon {
    font-size: 22px;
    color: var(--el-color-danger);
    flex-shrink: 0;
  }

  .error-content {
    flex: 1;
    min-width: 0;
  }

  .file-name {
    display: block;
    font-size: 13px;
    color: #303133;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .error-msg {
    font-size: 12px;
    color: var(--el-color-danger);
  }

  .error-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
}
</style>

