<template>
  <el-dialog
    v-model="dialogVisible"
    :title="t('dialog.editBookmark')"
    width="var(--lc-dialog-width-lg)"
  >
    <el-form
      ref="formRef"
      :model="form"
      label-width="var(--lc-form-label-width)"
    >
      <el-form-item :label="t('form.title')">
        <el-input v-model="form.title" />
      </el-form-item>

      <el-form-item :label="t('form.description')">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="3"
        />
      </el-form-item>

      <el-form-item :label="t('form.folder')">
        <el-select
          v-model="form.folderId"
          clearable
          style="width: 100%"
        >
          <el-option
            v-for="folder in folders"
            :key="folder.id"
            :label="folder.name"
            :value="folder.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item :label="t('form.tags')">
        <el-select
          v-model="form.tags"
          multiple
          style="width: 100%"
        >
          <el-option
            v-for="tag in tags"
            :key="tag.id"
            :label="tag.name"
            :value="tag.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item :label="t('form.color')">
        <el-color-picker v-model="form.color" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="handleClose">
        {{ t('common.cancel') }}
      </el-button>
      <el-button
        type="primary"
        @click="handleSubmit"
      >
        {{ t('common.save') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FormInstance } from 'element-plus'
import { storeToRefs } from 'pinia'
import { useBookmarkStore, useFolderStore, useTagStore } from '../../stores'

const { t } = useI18n()

interface Props {
  modelValue: boolean
  bookmark: any
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const bookmarkStore = useBookmarkStore()
const folderStore = useFolderStore()
const tagStore = useTagStore()
const { folders } = storeToRefs(folderStore)
const { tags } = storeToRefs(tagStore)

const dialogVisible = ref(false)
const formRef = ref<FormInstance>()
const form = ref({
  title: '',
  description: '',
  folderId: '',
  tags: [] as string[],
  color: '#3B82F6'
})

const handleSubmit = async () => {
  if (!formRef.value) return

  try {
    await formRef.value.validate()
  } catch {
    return
  }

  // B1：el-color-picker 被清空时会给出 null/空串。null 一旦落库，渲染层的取色逻辑
  // （BookmarkCard/ListView 依赖 color.slice/hexToRgba）就会崩溃，所以写入侧必须兜底。
  const color = form.value.color ? String(form.value.color) : '#3B82F6'

  // C17：必须 await —— 失败时保持弹窗打开，避免「先关闭再报错」以及未处理的 Promise rejection
  try {
    await bookmarkStore.updateBookmark(props.bookmark.id, { ...form.value, color })
    handleClose()
  } catch (error) {
    console.error('[EditDialog] Failed to update bookmark:', error)
  }
}

const handleClose = () => {
  dialogVisible.value = false
  emit('update:modelValue', false)
}

watch(
  () => props.modelValue,
  newVal => {
    dialogVisible.value = newVal

    if (newVal && props.bookmark) {
      form.value = {
        title: props.bookmark.title || '',
        description: props.bookmark.description || '',
        folderId: props.bookmark.folderId || '',
        tags: props.bookmark.tags || [],
        color: props.bookmark.color || '#3B82F6'
      }
    }
  }
)
</script>
