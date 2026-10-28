<template>
  <el-dialog
    v-model="dialogVisible"
    :title="t('dialog.addBookmark')"
    width="var(--lc-dialog-width-lg)"
    @close="handleClose"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="var(--lc-form-label-width)"
    >
      <el-form-item
        :label="t('form.url')"
        prop="url"
      >        <el-input
          v-model="form.url"
          :placeholder="t('form.placeholder.url')"
          @blur="fetchUrlMetadata"
        >
          <template #append>
            <el-button :loading="fetching" @click="fetchUrlMetadata">
              <i class="i-heroicons-arrow-path" />
            </el-button>
          </template>
        </el-input>
      </el-form-item>

      <el-form-item :label="t('form.title')" prop="title">
        <el-input v-model="form.title" :placeholder="t('form.placeholder.title')" />
      </el-form-item>

      <el-form-item :label="t('form.description')" prop="description">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="3"
          :placeholder="t('form.placeholder.description')"
        />
      </el-form-item>

      <el-form-item :label="t('form.folder')" prop="folderId">
        <el-select
          v-model="form.folderId"
          clearable
          :placeholder="t('form.selectFolder')"
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

      <el-form-item :label="t('form.tags')" prop="tags">
        <el-select
          v-model="form.tags"
          multiple
          :placeholder="t('form.selectTags')"
          style="width: 100%"
        >
          <el-option v-for="tag in tags" :key="tag.id" :label="tag.name" :value="tag.id">
            <div class="tag-option">
              <div class="tag-dot" :style="{ backgroundColor: tag.color }" />
              <span>{{ tag.name }}</span>
            </div>
          </el-option>
        </el-select>
      </el-form-item>

      <el-form-item :label="t('form.color')" prop="color">
        <div class="color-picker-wrapper">
          <el-color-picker v-model="form.color" :predefine="predefineColors" />
          <el-input
            v-model="form.color"
            class="color-input"
            placeholder="#3B82F6"
          />
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="handleClose">
        {{ t('common.cancel') }}
      </el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">
        {{ t('common.add') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { useBookmarkStore, useFolderStore, useTagStore, useUIStore } from '../../stores'
import { isValidUrl, normalizeUrl, validateBookmarkData } from '../../utils/validation'
import { getFaviconUrl, shouldFetchFavicon } from '../../utils/favicon'

const { t } = useI18n()

interface Props {
  modelValue: boolean
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const bookmarkStore = useBookmarkStore()
const folderStore = useFolderStore()
const tagStore = useTagStore()
const uiStore = useUIStore()
const { folders } = storeToRefs(folderStore)
const { tags } = storeToRefs(tagStore)
const { settings } = storeToRefs(uiStore)
const { addBookmark } = bookmarkStore

const dialogVisible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value)
})

const formRef = ref<FormInstance>()
const fetching = ref(false)
const submitting = ref(false)

const form = ref({
  url: '',
  title: '',
  description: '',
  folderId: '',
  tags: [] as string[],
  color: '#3B82F6',
  favicon: ''
})

const predefineColors = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#6366F1',
  '#14B8A6'
]

const rules = computed<FormRules>(() => ({
  url: [
    { required: true, message: t('validation.pleaseEnterUrl'), trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (!value) {
          callback()
          return
        }
        // B11：与提交时的校验口径保持一致（utils/validation.ts 的 normalizeUrl + isValidUrl），
        // 否则会出现「表单放行、提交静默失败」的不一致。
        if (isValidUrl(normalizeUrl(String(value)))) {
          callback()
        } else {
          callback(new Error(t('validation.invalidUrl')))
        }
      },
      trigger: 'blur'
    }
  ],
  title: [{ required: true, message: t('validation.pleaseEnterTitle'), trigger: 'blur' }]
  // A3：folderId 不再必填 —— 空值表示「未分类」，系统里没有任何文件夹时也能新增书签。
}))

/**
 * B12：从 URL 推导可用的最小元数据（标题 + 站点图标）。
 * 纯本地推导，不发网络请求（CSP 下渲染进程不应直接抓取外部页面）。
 * 失败时不再静默吞掉：写 console.warn，且不影响用户手动填写。
 */
const fetchUrlMetadata = async () => {
  if (!form.value.url) return

  const normalized = normalizeUrl(form.value.url)
  if (!isValidUrl(normalized)) {
    console.warn('[AddBookmarkDialog] Skip metadata for invalid URL:', form.value.url)
    return
  }

  try {
    fetching.value = true
    // 顺手把无协议输入归一化，避免用户提交 example.com 这类半成品字符串
    form.value.url = normalized

    if (!form.value.title) {
      form.value.title = new URL(normalized).hostname
    }

    const shouldFetch = settings.value?.autoFetchIcon ?? true
    if (shouldFetch && shouldFetchFavicon(normalized)) {
      form.value.favicon = getFaviconUrl(
        normalized,
        settings.value?.faviconService,
        settings.value?.useForeignFavicon
      )
    }
  } catch (error) {
    console.warn('[AddBookmarkDialog] Failed to derive metadata:', error)
  } finally {
    fetching.value = false
  }
}

const handleSubmit = async () => {
  if (!formRef.value) return

  try {
    await formRef.value.validate()
  } catch {
    // 字段级错误已由 el-form 在表单内展示，无需额外提示
    return
  }

  // B11：先归一化再校验/落库，`example.com` 不再被静默拒绝
  const normalizedUrl = normalizeUrl(form.value.url)
  const payload = { ...form.value, url: normalizedUrl }

  const validation = validateBookmarkData(payload)
  if (!validation.valid) {
    // A3/B11：校验失败必须有可见反馈，禁止静默 return
    ElMessage.warning(validation.errors[0])
    return
  }

  try {
    const shouldFetch = settings.value?.autoFetchIcon ?? true
    let favicon = form.value.favicon

    if (!favicon && shouldFetch && shouldFetchFavicon(normalizedUrl)) {
      favicon = getFaviconUrl(
        normalizedUrl,
        settings.value?.faviconService,
        settings.value?.useForeignFavicon
      )
    }

    submitting.value = true
    await addBookmark({
      ...payload,
      favicon
    })
    handleClose()
  } catch (error) {
    // store 内部已提示失败，这里只记录，避免重复 toast
    console.error('[AddBookmarkDialog] Failed to add bookmark:', error)
  } finally {
    submitting.value = false
  }
}

const handleClose = () => {
  form.value = {
    url: '',
    title: '',
    description: '',
    folderId: '',
    tags: [],
    color: '#3B82F6',
    favicon: ''
  }
  formRef.value?.resetFields()
  dialogVisible.value = false
}

watch(
  () => props.modelValue,
  async visible => {
    if (visible) {
      await Promise.allSettled([folderStore.fetchFolders(), tagStore.fetchTags()])
      // A3：不再自动选中第一个文件夹。'' 即「未分类」，也避免用户在无文件夹时被卡死。
    }
  }
)
</script>

<style scoped>
/* 弹窗内布局统一走设计变量（契约 §3：禁止硬编码颜色/间距/圆角/字号） */
.color-picker-wrapper {
  display: flex;
  align-items: center;
  gap: var(--lc-space-3);
}

.color-input {
  width: 120px;
}

.tag-option {
  display: flex;
  align-items: center;
  gap: var(--lc-space-2);
}

.tag-dot {
  width: var(--lc-space-2);
  height: var(--lc-space-2);
  border-radius: var(--lc-radius-pill);
  flex-shrink: 0;
}
</style>
