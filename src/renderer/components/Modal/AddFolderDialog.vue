<template>
  <el-dialog
    v-model="dialogVisible"
    :title="t('dialog.addFolder')"
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
          ref="nameInputRef"
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
        {{ t('common.add') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FormInstance, FormRules, InputInstance } from 'element-plus'
import { useFolderStore } from '../../stores'

const { t } = useI18n()

interface Props {
  modelValue: boolean
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const folderStore = useFolderStore()
const { addFolder } = folderStore

const dialogVisible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value)
})

const formRef = ref<FormInstance>()
const nameInputRef = ref<InputInstance>()
const form = ref({
  name: '',
  color: '#3B82F6'
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
    await addFolder({ name: form.value.name, color: form.value.color })
    handleClose()
  } catch {
    // Validation failed
  }
}

const handleClose = () => {
  form.value.name = ''
  form.value.color = '#3B82F6'
  formRef.value?.resetFields()
  dialogVisible.value = false
}

watch(
  () => props.modelValue,
  visible => {
    if (visible) {
      // C9：用 el-input 的 ref 聚焦弹窗内的输入框。
      // 旧实现用 document.querySelector('.el-input__inner')，会命中页面上第一个输入框（通常是侧栏搜索）。
      setTimeout(() => nameInputRef.value?.focus(), 100)
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
