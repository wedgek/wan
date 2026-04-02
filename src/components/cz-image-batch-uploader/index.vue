<template>
    <div class="cz-image-batch-uploader">
        <div class="upload-list">
            <!-- 已上传 -->
            <div v-for="(item, index) in modelValue" :key="item.url" class="upload-item uploaded ani-img-zoom-lg">
                <img :src="item.url" loading="lazy" />
                <div class="mask" @click.stop="removeItem(index)">
                    <el-icon><Delete /></el-icon>
                </div>
                <span class="name" :title="item.imageName">{{ item.imageName }}</span>
            </div>
            
            <!-- 上传中 / 等待中 -->
            <div v-for="item in [...uploadingList, ...pendingList]" :key="item.uid" class="upload-item loading">
                <el-icon class="is-loading"><Loading /></el-icon>
            </div>
            
            <!-- 添加 -->
            <div class="upload-item add" @click="triggerUpload">
                <input ref="inputRef" type="file" accept="image/*" multiple @change="handleFileChange" />
                <el-icon><Plus /></el-icon>
            </div>
        </div>
        
        <!-- 底部操作 -->
        <div v-if="modelValue.length" class="footer">
            <span class="count">{{ modelValue.length }} 张</span>
            <el-button type="primary" link size="small" @click="clearAll">清空</el-button>
        </div>
    </div>
</template>

<script setup>
import { uploadBatch, OSS_DIRS } from '@/request/oss'

const props = defineProps({
    modelValue: { type: Array, default: () => [] },
    dir: { type: String, default: OSS_DIRS.IMAGE },
    maxConcurrent: { type: Number, default: 6 }
})

const emit = defineEmits(['update:modelValue'])

const inputRef = ref(null)
const uploadingList = ref([])
const pendingList = ref([])

const triggerUpload = () => inputRef.value?.click()

const handleFileChange = (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    
    const total = props.modelValue.length + uploadingList.value.length + pendingList.value.length + files.length
    if (total > 500) {
        ElMessage('最多支持上传 500 张图片')
        e.target.value = ''
        return
    }
    
    const tasks = files.map(file => {
        const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
        file.uid = uid
        return { uid, file }
    })
    
    pendingList.value.push(...tasks)
    e.target.value = ''
    startUpload()
}

let uploading = false
const startUpload = async () => {
    if (uploading || !pendingList.value.length) return
    uploading = true
    
    const tasks = pendingList.value.splice(0)
    uploadingList.value.push(...tasks)
    
    await uploadBatch(tasks.map(t => t.file), {
        dir: props.dir,
        maxConcurrent: props.maxConcurrent,
        onFileComplete: (uid, url, file) => {
            uploadingList.value = uploadingList.value.filter(i => i.uid !== uid)
            emit('update:modelValue', [...props.modelValue, { url, imageName: file.name }])
        },
        onFileError: (uid, _, file) => {
            uploadingList.value = uploadingList.value.filter(i => i.uid !== uid)
            ElMessage.error(`${file.name} 上传失败`)
        }
    })
    
    uploading = false
    if (pendingList.value.length) startUpload()
}

const removeItem = (index) => {
    const list = [...props.modelValue]
    list.splice(index, 1)
    emit('update:modelValue', list)
}

const clearAll = () => emit('update:modelValue', [])
</script>

<style lang="scss" scoped>
.cz-image-batch-uploader {
    .upload-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, 72px);
        gap: 8px;
    }
    
    .upload-item {
        position: relative;
        width: 72px;
        height: 72px;
        border-radius: 4px;
        overflow: hidden;
        
        &.uploaded {
            &:hover .mask { opacity: 1; }
            &:hover .name { opacity: 1; }
            
            .mask {
                position: absolute;
                inset: 0;
                background: rgba(0, 0, 0, 0.4);
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                transition: opacity 0.2s;
                cursor: pointer;
                
                .el-icon {
                    font-size: 18px;
                    color: #fff;
                    transition: transform 0.15s;
                    &:hover { transform: scale(1.15); }
                }
            }
            
            .name {
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                height: 20px;
                line-height: 20px;
                padding: 0 4px;
                font-size: 10px;
                color: #fff;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.2s;
            }
        }
        
        &.loading {
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px solid #eee;
            background: #fafafa;
            
            .is-loading {
                font-size: 22px;
                color: $primary-color;
            }
        }
        
        &.add {
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px dashed #dcdfe6;
            background: #fafafa;
            cursor: pointer;
            transition: border-color 0.2s;
            
            &:hover {
                border-color: $primary-color;
                .el-icon { color: $primary-color; }
            }
            
            input { display: none; }
            
            .el-icon {
                font-size: 20px;
                color: #c0c4cc;
                transition: color 0.2s;
            }
        }
    }
    
    .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 10px;
        border-top: 1px solid #f0f0f0;
        
        .count {
            font-size: 12px;
            color: $text-secondary;
        }
        
        .clear {
            font-size: 12px;
            color: $text-secondary;
            cursor: pointer;
            
            &:hover { color: #f56c6c; }
        }
    }
}
</style>

