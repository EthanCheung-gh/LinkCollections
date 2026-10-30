<template>
  <el-dialog
    v-model="dialogVisible"
    :title="t('dialog.editFolder')"
    width="var(--lc-dialog-width-md)"
    @close="handleClose"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="var(--lc-form-label-width)"
    >
      <el-form-item
        :label="t('form.folderName')"
        prop="name"
      >
        <el-input
          v-model="form.name"
          :placeholder="t('form.placeholder.folderName')"
          @keyup.enter="handleSubmit"
        />
      </el-form-item>

      <el-form-item :label="t('folder.parentFolder')">
        <el-select
          v-model="form.parentId"
          class="parent-select"
          clearable
          :placeholder="t('folder.topLevel')"
        >
          <el-option
            v-for="node in parentOptions"
            :key="node.id"
            :label="node.name"
            :value="node.id"
          >
            <span :style="{ paddingLeft: `calc(var(--lc-space-3) * ${node.depth})` }">
              {{ node.name }}
            </span>
          </el-option>
        </el-select>
      </el-form-item>

      <el-form-item :label="t('form.color')">
        <div class="color-picker-wrapper">
          <el-color-picker
            v-model="form.color"
            :predefine="predefineColors"
          />
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
import { ref, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import { useFolderStore } from '../../stores'
import type { FolderTreeNode } from '../../types'

const { t } = useI18n()

interface Props {
  modelValue: boolean
  folder: any
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'updated', updates: any): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const folderStore = useFolderStore()
const { folderTree } = storeToRefs(folderStore)
const { descendantIdsOf } = folderStore

const dialogVisible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value)
})

const formRef = ref<FormInstance>()
const form = ref({
  name: '',
  color: '#3B82F6',
  id: '',
  /** 上级文件夹 id；`null` / `''` = 顶层 */
  parentId: null as string | null
})

/** 空值（clearable 会把值置为 undefined）统一归一为「顶层」(`null`) */
const normalizeParentId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * 父级候选项 = 全部文件夹 − 自身 − 自身所有后代。
 * 后端 update-folder 还会再校验一次（`throw new Error('Invalid parent folder')`），
 * 这里排除只是为了让用户根本选不出环。
 */
const parentOptions = computed<FolderTreeNode[]>(() => {
  if (!form.value.id) return folderTree.value
  const excluded = new Set(descendantIdsOf(form.value.id))
  return folderTree.value.filter(node => !excluded.has(node.id))
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
  name: [
    { required: true, message: t('validation.pleaseEnterFolderName'), trigger: 'blur' },
    {
      min: 1,
      max: 50,
      message: t('validation.nameLength', { n: 50 }),
      trigger: 'blur'
    }
  ]
}))

const handleSubmit = async () => {
  if (!formRef.value) return

  try {
    await formRef.value.validate()
  } catch {
    return
  }

  // B4：弹窗只负责收集与校验，真正的写库 + 关闭 + 提示由父组件（FolderList.handleFolderUpdate）
  // 统一执行。此处不得再调用 store 或自行弹 toast，否则每次编辑会写两次库、弹三条成功提示。
  if (!form.value.id) {
    ElMessage.error(t('validation.missingId'))
    return
  }

  emit('updated', {
    name: form.value.name,
    color: form.value.color,
    parentId: normalizeParentId(form.value.parentId)
  })
  handleClose()
}

const handleClose = () => {
  form.value = {
    name: '',
    color: '#3B82F6',
    id: '',
    parentId: null
  }
  formRef.value?.resetFields()
  dialogVisible.value = false
}

watch(
  () => props.folder,
  newFolder => {
    if (newFolder) {
      form.value = {
        name: newFolder.name,
        color: newFolder.color || '#3B82F6',
        id: newFolder.id,
        parentId: normalizeParentId(newFolder.parentId)
      }
    }
  }
)
</script>

<style scoped>
.color-picker-wrapper {
  display: flex;
  align-items: center;
  gap: var(--lc-space-3);
}

.color-input {
  width: 120px;
}

/* 上级文件夹下拉占满 label 右侧的可用宽度（不做硬编码宽度） */
.parent-select {
  width: 100%;
}
</style>
