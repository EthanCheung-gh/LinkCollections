<template>
  <el-dialog
    v-model="dialogVisible"
    :title="t('dialog.editTag')"
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
        :label="t('form.tagName')"
        prop="name"
      >
        <el-input
          v-model="form.name"
          :placeholder="t('form.placeholder.tagName')"
          @keyup.enter="handleSubmit"
        />
      </el-form-item>
      <el-form-item
        :label="t('form.tagColor')"
        prop="color"
      >
        <div class="color-picker-wrapper">
          <el-color-picker
            v-model="form.color"
            show-alpha
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

const { t } = useI18n()

interface Props {
  modelValue: boolean
  tag: any
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'updated', tag: any): void
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
    { required: true, message: t('validation.pleaseEnterTagName'), trigger: 'blur' },
    {
      min: 1,
      max: 30,
      message: t('validation.nameLength', { n: 30 }),
      trigger: 'blur'
    }
  ],
  color: [{ required: true, message: t('validation.pleaseSelectColor'), trigger: 'blur' }]
}))

const handleSubmit = async () => {
  if (!formRef.value) return

  try {
    await formRef.value.validate()
  } catch {
    return
  }

  // B4：与 EditFolderDialog 同一约定 —— 弹窗只 emit 一次，写库/提示由父组件
  // （TagList.handleTagUpdate）统一负责，避免重复写库与重复 toast。
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
  () => props.tag,
  newTag => {
    if (newTag) {
      form.value = {
        name: newTag.name,
        color: newTag.color || '#3B82F6',
        id: newTag.id
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
