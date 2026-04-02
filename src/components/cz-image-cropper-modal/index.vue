<template>
  <el-dialog
    v-model="visible"
    :title="title"
    :width="width"
    append-to-body
    destroy-on-close
    class="cz-image-cropper-modal"
  >
    <div
      class="upload-shell"
      v-loading="loading"
      :element-loading-text="loadingText"
      element-loading-background="rgba(255, 255, 255, 0.75)"
    >
      <div class="upload-grid" :class="{ 'no-preview': !showPreview }">
        <!-- 左侧：上传 / 裁剪 -->
        <div class="left">
          <div class="section-title">
            <span>{{ enableCrop ? "裁剪设置" : "图片选择" }}</span>
            <el-tag v-if="enableCrop && hasTargetSize" size="small" effect="plain" type="info">
              导出：{{ targetWidth }} × {{ targetHeight }}
            </el-tag>
          </div>

          <!-- 未选择文件 -->
          <div v-if="!rawUrl" class="dropzone">
            <el-upload
              ref="uploadRef"
              class="uploader"
              :show-file-list="false"
              :auto-upload="false"
              :accept="accept"
              :on-change="handleFileChange"
              drag
            >
              <div class="dropzone-inner">
                <div class="icon">
                  <el-icon><UploadFilled /></el-icon>
                </div>
                <div class="text">
                  <div class="primary">点击或拖拽图片到此处</div>
                  <div class="secondary">支持 {{ acceptText }}，大小不超过 {{ maxSize }}MB</div>
                </div>
              </div>
            </el-upload>
          </div>

          <!-- 已选择文件：裁剪模式 -->
          <div v-else-if="enableCrop" class="cropper-area">
            <div class="cropper-wrap">
              <img ref="imgRef" :src="rawUrl" alt="cropper" class="cropper-image" />
            </div>

            <div class="toolbar">
              <el-button-group>
                <el-button :icon="ZoomIn" @click="zoom(0.1)" title="放大" />
                <el-button :icon="ZoomOut" @click="zoom(-0.1)" title="缩小" />
                <el-button :icon="RefreshLeft" @click="rotate(-90)" title="左旋转" />
                <el-button :icon="RefreshRight" @click="rotate(90)" title="右旋转" />
                <el-button :icon="Refresh" @click="resetCrop" title="重置" />
              </el-button-group>
              <el-button :icon="$icons.Switch" plain @click="reselect">重新选择</el-button>
            </div>
          </div>

          <!-- 已选择文件：不裁剪，直接预览 -->
          <div v-else class="simple-preview">
            <div class="simple-preview__img" :class="{ circle }">
              <el-image :src="rawUrl" fit="cover" />
            </div>
            <div class="toolbar toolbar--simple">
              <el-button :icon="Refresh" plain @click="reselect">重新选择</el-button>
            </div>
          </div>
        </div>

        <!-- 右侧：实时预览 / 信息 -->
        <div class="right" v-if="showPreview">
          <div class="section-title">
            <span>实时预览</span>
          </div>

          <div class="previews">
            <div class="preview-block">
              <div class="preview-label">预览（仅展示，裁剪始终为矩形）</div>
              <!-- 空状态 -->
              <div v-if="!rawUrl" class="preview-box is-empty" :style="previewBoxStyle" :class="{ 'is-circle': circle }">
                <div class="preview-empty">
                  <el-icon><Picture /></el-icon>
                </div>
              </div>
              <!-- Cropper 预览容器 -->
              <div
                v-else
                class="preview-box cz-image-cropper-modal-preview"
                :class="{ 'is-circle': circle }"
                :style="previewBoxStyle"
              ></div>
            </div>
          </div>

          <div class="meta" v-if="fileMeta.name">
            <div class="meta-item">
              <span class="k">文件名</span>
              <span class="v" :title="fileMeta.name">{{ displayFileName }}</span>
            </div>
            <div class="meta-item">
              <span class="k">大小</span>
              <span class="v">{{ fileMeta.sizeText }}</span>
            </div>
          </div>

          <el-alert
            v-if="rawUrl"
            class="hint"
            type="info"
            show-icon
            :closable="false"
            title="确认无误后点击底部“确认上传”"
          />
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button 
        type="primary" 
        :loading="loading" 
        :disabled="!rawUrl" 
        @click="handleUpload"
      >
        确认上传
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, reactive, nextTick, watch, onBeforeUnmount } from 'vue'
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'
import { ElMessage } from 'element-plus'
import { uploadImage } from '@/request/oss'
import { UploadFilled, Refresh, ZoomIn, ZoomOut, RefreshLeft, RefreshRight, Delete } from '@element-plus/icons-vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '上传图片' },
  width: { type: String, default: '860px' },
  // 允许的格式
  accept: { type: String, default: '.jpg,.jpeg,.png' },
  // 最大文件大小 (MB)
  maxSize: { type: Number, default: 5 },
  // 是否圆形预览（用于头像）
  circle: { type: Boolean, default: false },
  // 是否开启裁剪
  enableCrop: { type: Boolean, default: true },
  // 目标导出尺寸：宽高（用于自动计算比例 + 导出宽高）
  targetWidth: { type: Number, default: 0 },
  targetHeight: { type: Number, default: 0 },
  // 兼容：允许外部直接传比例（当 targetWidth/targetHeight 不传时才会使用）
  aspectRatio: { type: Number, default: 0 },
  // 导出格式
  outputType: { type: String, default: 'image/jpeg' },
  // 导出质量（jpeg/webp 有效）
  outputQuality: { type: Number, default: 0.92 },
  // 文件名展示：前多少位 + 后多少位（中间省略）
  fileNameHead: { type: Number, default: 14 },
  fileNameTail: { type: Number, default: 10 },
})

const emit = defineEmits(['update:modelValue', 'success', 'close'])

const uploadRef = ref()
const imgRef = ref()
const cropper = ref(null)
const loading = ref(false)
const loadingText = ref('处理中...')
const selectedFile = ref(null)
const rawUrl = ref('')

const fileMeta = reactive({ name: '', size: 0, sizeText: '' })

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const acceptText = computed(() => props.accept.replace(/\./g, '').toUpperCase())
const hasTargetSize = computed(() => Number(props.targetWidth) > 0 && Number(props.targetHeight) > 0)
const targetWidth = computed(() => Number(props.targetWidth) || 0)
const targetHeight = computed(() => Number(props.targetHeight) || 0)
const showPreview = computed(() => !!props.enableCrop)

// 裁剪比例：优先根据目标导出宽高计算
const effectiveAspectRatio = computed(() => {
  if (hasTargetSize.value) return targetWidth.value / targetHeight.value
  const r = Number(props.aspectRatio)
  return r && isFinite(r) ? r : NaN
})

const previewBoxStyle = computed(() => {
  // 预览区跟随目标比例，如果没有目标比例默认 1:1
  const r = effectiveAspectRatio.value
  const ratio = r && isFinite(r) ? r : 1
  return { aspectRatio: `${ratio} / 1` }
})

const displayFileName = computed(() => {
  const name = fileMeta.name || ''
  if (!name) return ''

  const head = Math.max(0, Number(props.fileNameHead) || 0)
  const tail = Math.max(0, Number(props.fileNameTail) || 0)
  if (!head && !tail) return name
  if (name.length <= head + tail + 3) return name

  const prefix = head ? name.slice(0, head) : ''
  const suffix = tail ? name.slice(-tail) : ''
  return `${prefix}...${suffix}`
})

// ------------------- 文件选择 -------------------
const handleFileChange = (file) => {
  const isLtSize = file.size / 1024 / 1024 < props.maxSize
  if (!isLtSize) {
    ElMessage(`图片大小不能超过 ${props.maxSize}MB`)
    return false
  }

  selectedFile.value = file.raw
  cleanupUrl()
  rawUrl.value = URL.createObjectURL(file.raw)
  fileMeta.name = file.raw?.name || ''
  fileMeta.size = file.raw?.size || 0
  fileMeta.sizeText = formatSize(fileMeta.size)
}

// ------------------- 上传 -------------------
const handleUpload = async () => {
  if (!selectedFile.value) return
  loading.value = true
  loadingText.value = props.enableCrop ? '生成裁剪图片...' : '准备上传...'
  await nextTick()
  const blob = await getUploadBlob()
  loadingText.value = '上传中...'

  try {
    const file = new File([blob], buildFileName(), { type: props.outputType })
    const url = await uploadImage(file)
    emit('success', url)
    visible.value = false
  } catch (e) {
    console.error(e)
    ElMessage.error(e.message || '上传失败')
  } finally {
    loading.value = false
  }
}

// ------------------- 获取裁剪 blob -------------------
const getUploadBlob = async () => {
  if (!props.enableCrop || !cropper.value) return selectedFile.value
  const canvas = cropper.value.getCroppedCanvas(
    props.targetWidth && props.targetHeight ? { width: props.targetWidth, height: props.targetHeight } : undefined
  )
  if (!canvas) return selectedFile.value
  return await new Promise(res => canvas.toBlob(b => res(b), props.outputType, props.outputQuality))
}

// ------------------- 裁剪操作 -------------------
const zoom = delta => cropper.value?.zoom(delta)
const rotate = deg => cropper.value?.rotate(deg)
const resetCrop = () => cropper.value?.reset()
const reselect = () => {
  selectedFile.value = null
  fileMeta.name = ''
  fileMeta.size = 0
  fileMeta.sizeText = ''
  cleanupUrl()
  rawUrl.value = ''
  destroyCropper()
}

const cleanupUrl = () => {
  if (rawUrl.value) URL.revokeObjectURL(rawUrl.value)
}
const destroyCropper = () => {
  if (cropper.value) {
    cropper.value.destroy()
    cropper.value = null
  }
}

// ------------------- 初始化 Cropper -------------------
const rebuildCropper = () => {
  destroyCropper()
  if (!props.enableCrop || !rawUrl.value || !imgRef.value) return
  const imgEl = imgRef.value
  if (!imgEl.complete) {
    imgEl.onload = () => initCropper(imgEl)
  } else {
    initCropper(imgEl)
  }
}
const initCropper = (imgEl) => {
  cropper.value = new Cropper(imgEl, {
    aspectRatio: effectiveAspectRatio.value,
    viewMode: 1,
    dragMode: 'move',
    autoCropArea: 0.9,
    background: false,
    responsive: true,
    guides: true,
    center: true,
    zoomOnWheel: true,
    toggleDragModeOnDblclick: false,
    cropBoxMovable: true,
    cropBoxResizable: true,
    preview: '.cz-image-cropper-modal-preview',
  })
}

// ------------------- 工具函数 -------------------
const formatSize = (bytes) => {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

const buildFileName = () => {
  const base = (fileMeta.name || 'image').replace(/\.[^/.]+$/, '')
  const ext = (props.outputType || '').includes('png') ? 'png' : 'jpg'
  return `${base}.${ext}`
}

// ------------------- 监听 rawUrl 变化 -------------------
watch(
  () => [rawUrl.value, effectiveAspectRatio.value, props.enableCrop],
  async () => {
    await nextTick()
    rebuildCropper()
  }
)

// ------------------- 弹窗关闭 / 重置状态 -------------------
watch(visible, (val) => {
  if (!val) resetAll()
})

const resetAll = () => {
  destroyCropper()
  cleanupUrl()
  selectedFile.value = null
  rawUrl.value = ''
  fileMeta.name = ''
  fileMeta.size = 0
  fileMeta.sizeText = ''
  loading.value = false
  loadingText.value = '处理中...'
  emit('close')
}

// ------------------- 组件卸载 -------------------
onBeforeUnmount(() => {
  destroyCropper()
  cleanupUrl()
})

</script>

<style lang="scss" scoped>
.cz-image-cropper-modal {
  :deep(.el-dialog__body) {
    padding: 20px 24px;
  }
}

.upload-shell {
  border-radius: 10px;
}

.upload-grid {
  display: grid;
  grid-template-columns: 1fr 288px;
  gap: 18px;
  align-items: start;
}

.upload-grid.no-preview {
  grid-template-columns: 1fr;
}

.left,
.right {
  border-radius: 10px;
  background: #fff;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(240, 247, 255, 0.65), rgba(255, 255, 255, 0));
  margin-bottom: 10px;
  color: $text-primary;
  font-weight: 600;
  font-size: 14px;
}

.dropzone {
  border: 1px dashed rgba(0, 0, 0, 0.14);
  border-radius: 10px;
  background: #fcfdff;
  overflow: hidden;

  .uploader {
    width: 100%;
  }

  :deep(.el-upload-dragger) {
    border: none !important;
    background: transparent !important;
    padding: 0 !important;
  }

  :deep(.el-upload) {
    width: 100%;
  }

  .dropzone-inner {
    padding: 132px 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    transition: background-color 0.2s ease, border-color 0.2s ease;
  }

  .icon {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    background: $primary-bg;
    display: flex;
    align-items: center;
    justify-content: center;
    color: $primary-color;
    font-size: 22px;
    position: relative;
    overflow: hidden;
    &::after {
      content: "";
      position: absolute;
      width: 6px;
      height: 6px;
      background: #1890ff;
      border-radius: 50%;
      bottom: 4px;
      right: 4px;
      opacity: 0;
      animation: ani-pulse-dot 1.2s infinite;
    }
  }

  .text {
    .primary {
      font-size: 15px;
      font-weight: 600;
      color: $text-primary;
      margin-bottom: 6px;
      text-align: left;
    }
    .secondary {
      font-size: 13px;
      color: $text-secondary;
    }
  }

  &:hover {
    border-color: rgba(24, 144, 255, 0.55);
    background: #f8fbff;
  }
}

.cropper-area {
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 10px;
  overflow: hidden;

  .cropper-wrap {
    height: 376px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .cropper-image {
    max-width: 100%;
    max-height: 100%;
    display: block;
    opacity: 0.95;
  }

  .toolbar {
    padding: 12px;
    display: flex;
    justify-content: space-between;
    gap: 10px;
    background: #fff;
    border-top: 1px solid rgba(0, 0, 0, 0.06);
  }

  .toolbar--simple {
    justify-content: flex-end;
  }
}

.simple-preview {
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 10px;
  overflow: hidden;
  background: #fff;

  .simple-preview__img {
    height: 420px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0b1220;
    padding: 16px;

    :deep(.el-image) {
      width: 320px;
      height: 320px;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    }

    &.circle :deep(.el-image) {
      border-radius: 50%;
    }
  }

  .toolbar {
    padding: 12px;
    border-top: 1px solid rgba(0, 0, 0, 0.06);
    display: flex;
    justify-content: flex-end;
  }
}

.right {
  border: 1px solid rgba(0, 0, 0, 0.06);
  padding: 12px;
}

.previews {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.preview-block {
  .preview-label {
    font-size: 12px;
    color: $text-secondary;
    margin-bottom: 8px;
  }
  .preview-box {
    width: 100%;
    border-radius: 10px;
    overflow: hidden;
    background: #fcfdff;
    border: 1px solid rgba(0, 0, 0, 0.06);
    
    &.is-empty {
      border: 1px dashed rgba(0, 0, 0, 0.12);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    &.is-circle { border-radius: 50%; }
  }
  
  .preview-empty {
    color: #dcdfe6;
    .el-icon { font-size: 32px; }
  }
}

.meta {
  margin-top: 14px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  padding-top: 12px;

  .meta-item {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
    font-size: 12px;
    .k {
      color: $text-secondary;
      flex: 0 0 auto;
    }
    .v {
      color: $text-primary;
      flex: 1 1 auto;
      text-align: right;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
}

.hint {
  margin-top: 10px;
  
  :deep(.el-alert__title) {
    font-size: 13px;
  }
}

</style>

