<template>
  <div class="import-export-section">
    <h2 class="section-title">
      <i class="i-heroicons-arrows-up-down" />
      {{ t('importExport.title') }}
    </h2>

    <div class="import-export-grid">
      <div class="action-card">
        <div class="action-icon">
          <i class="i-heroicons-arrow-down-tray" />
        </div>
        <h3>{{ t('importExport.exportData') }}</h3>
        <p>{{ t('importExport.exportFormat') }}</p>
        <div class="action-buttons">
          <el-button
            type="primary"
            :loading="exportingJson"
            @click="handleExportJson"
          >
            {{ t('importExport.jsonFormat') }}
          </el-button>
          <el-button
            :loading="exportingHtml"
            @click="handleExportHtml"
          >
            {{ t('importExport.htmlFormat') }}
          </el-button>
        </div>
      </div>

      <div class="action-card">
        <div class="action-icon">
          <i class="i-heroicons-arrow-up-tray" />
        </div>
        <h3>{{ t('importExport.importData') }}</h3>
        <p>{{ t('importExport.importFormat') }}</p>
        <div class="import-options">
          <el-radio-group v-model="importMergeMode">
            <el-radio-button value="merge">
              {{ t('importExport.merge') }}
            </el-radio-button>
            <el-radio-button value="replace">
              {{ t('importExport.replace') }}
            </el-radio-button>
          </el-radio-group>
        </div>
        <div class="action-buttons">
          <el-button
            type="primary"
            :loading="importingJson"
            @click="handleImportJson"
          >
            {{ t('importExport.jsonFormat') }}
          </el-button>
          <el-button
            :loading="importingHtml"
            @click="handleImportHtml"
          >
            {{ t('importExport.htmlFormat') }}
          </el-button>
        </div>
      </div>
    </div>

    <el-alert
      v-if="lastImportResult"
      class="import-alert"
      :title="`${t('importExport.importSuccess')}: ${lastImportResult.imported.bookmarks} ${t('bookmark.title')}, ${lastImportResult.imported.folders} ${t('folder.title')}, ${lastImportResult.imported.tags} ${t('tag.title')}`"
      type="success"
      :closable="false"
      show-icon
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { useBookmarkStore, useFolderStore, useTagStore } from '../../stores'
import type { ImportResult } from '../../types/import-export'

const { t } = useI18n()
const bookmarkStore = useBookmarkStore()
const folderStore = useFolderStore()
const tagStore = useTagStore()

const importMergeMode = ref<'merge' | 'replace'>('merge')

const exportingJson = ref(false)
const exportingHtml = ref(false)
const importingJson = ref(false)
const importingHtml = ref(false)

const lastImportResult = ref<ImportResult | null>(null)

const handleExportJson = async () => {
  try {
    exportingJson.value = true
    const result = await window.electronAPI.exportData('json')
    if (result.success) {
      ElMessage.success(`${t('importExport.exportSuccess')}: ${result.filePath}`)
    } else if (!result.canceled) {
      ElMessage.error(t('importExport.exportFailed'))
    }
  } catch (error) {
    ElMessage.error(t('importExport.exportFailed'))
    console.error(error)
  } finally {
    exportingJson.value = false
  }
}

const handleExportHtml = async () => {
  try {
    exportingHtml.value = true
    const result = await window.electronAPI.exportData('html')
    if (result.success) {
      ElMessage.success(`${t('importExport.exportSuccess')}: ${result.filePath}`)
    } else if (!result.canceled) {
      ElMessage.error(t('importExport.exportFailed'))
    }
  } catch (error) {
    ElMessage.error(t('importExport.exportFailed'))
    console.error(error)
  } finally {
    exportingHtml.value = false
  }
}

const handleImportJson = async () => {
  try {
    importingJson.value = true
    const result = await window.electronAPI.importData('json', importMergeMode.value)
    if (result.success) {
      lastImportResult.value = result as ImportResult
      await bookmarkStore.fetchBookmarks()
      await folderStore.fetchFolders()
      await tagStore.fetchTags()
      ElMessage.success(t('importExport.importSuccess'))
    } else if (!result.canceled) {
      ElMessage.error(t('importExport.importFailed'))
    }
  } catch (error) {
    ElMessage.error(t('importExport.importFailed'))
    console.error(error)
  } finally {
    importingJson.value = false
  }
}

const handleImportHtml = async () => {
  try {
    importingHtml.value = true
    const result = await window.electronAPI.importData('html', importMergeMode.value)
    if (result.success) {
      lastImportResult.value = result as ImportResult
      await bookmarkStore.fetchBookmarks()
      await folderStore.fetchFolders()
      ElMessage.success(t('importExport.importSuccess'))
    } else if (!result.canceled) {
      ElMessage.error(t('importExport.importFailed'))
    }
  } catch (error) {
    ElMessage.error(t('importExport.importFailed'))
    console.error(error)
  } finally {
    importingHtml.value = false
  }
}
</script>

<style scoped>
.import-export-section {
  min-width: 0;
  padding: var(--lc-space-5);
  background-color: var(--lc-bg-surface);
  border: 1px solid var(--lc-border-subtle);
  border-radius: var(--lc-radius-lg);
  box-shadow: var(--lc-shadow-card);
}

.section-title {
  display: flex;
  align-items: center;
  gap: var(--lc-space-2);
  margin: 0 0 var(--lc-space-4);
  padding-bottom: var(--lc-space-3);
  border-bottom: 1px solid var(--lc-border-subtle);
  font-size: var(--lc-font-lg);
  font-weight: var(--lc-weight-semibold);
  color: var(--lc-text-primary);
}

.section-title i {
  font-size: 20px;
  color: var(--lc-accent);
}

.import-export-grid {
  display: grid;
  /* min() 兜底：容器窄于 280px 时不会横向溢出 */
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  gap: var(--lc-space-4);
}

.action-card {
  min-width: 0;
  padding: var(--lc-space-5);
  border: 1px solid var(--lc-border-subtle);
  border-radius: var(--lc-radius-md);
  text-align: center;
}

.action-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin: 0 auto var(--lc-space-3);
  background-color: var(--lc-accent-soft);
  border-radius: var(--lc-radius-pill);
}

.action-icon i {
  font-size: 24px;
  color: var(--lc-accent);
}

.action-card h3 {
  margin: 0 0 var(--lc-space-2);
  font-size: var(--lc-font-lg);
  font-weight: var(--lc-weight-semibold);
  color: var(--lc-text-primary);
}

.action-card p {
  margin: 0 0 var(--lc-space-4);
  font-size: var(--lc-font-sm);
  color: var(--lc-text-muted);
}

.action-buttons {
  display: flex;
  gap: var(--lc-space-3);
  justify-content: center;
}

.action-buttons :deep(.el-button) {
  height: var(--lc-control-lg);
}

/* EP 默认给相邻按钮加 margin-left，这里统一由 gap 表达 */
.action-buttons :deep(.el-button + .el-button) {
  margin-left: 0;
}

.import-options {
  margin-bottom: var(--lc-space-4);
}

.import-options :deep(.el-radio-button__inner) {
  display: inline-flex;
  align-items: center;
  height: var(--lc-control-lg);
}

.import-alert {
  margin-top: var(--lc-space-4);
}
</style>
