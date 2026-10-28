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
import { useI18n } from 'vue-i18n'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'

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

const dialogVisible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value)
})

const formRef = ref<FormInstance>()
const form = ref({
  name: '',
  color: '#3B82F6',
  id: ''
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
    color: form.value.color
  })
  handleClose()
}

const handleClose = () => {
  form.value = {
    name: '',
    color: '#3B82F6',
    id: ''
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
        id: newFolder.id
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
</style>
