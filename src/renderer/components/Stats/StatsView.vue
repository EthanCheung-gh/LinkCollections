<template>
  <div class="stats-view">
    <h1 class="stats-title">
      {{ t('stats.title') }}
    </h1>

    <div class="stats-cards">
      <div class="stat-card">
        <div class="stat-icon total">
          <i class="i-heroicons-bookmark" />
        </div>
        <div class="stat-content">
          <div class="stat-value">
            {{ totalBookmarks }}
          </div>
          <div class="stat-label">
            {{ t('stats.totalBookmarks') }}
          </div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon folders">
          <i class="i-heroicons-folder" />
        </div>
        <div class="stat-content">
          <div class="stat-value">
            {{ totalFolders }}
          </div>
          <div class="stat-label">
            {{ t('stats.totalFolders') }}
          </div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon tags">
          <i class="i-heroicons-tag" />
        </div>
        <div class="stat-content">
          <div class="stat-value">
            {{ totalTags }}
          </div>
          <div class="stat-label">
            {{ t('stats.totalTags') }}
          </div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon visits">
          <i class="i-heroicons-chart-bar" />
        </div>
        <div class="stat-content">
          <div class="stat-value">
            {{ totalVisits }}
          </div>
          <div class="stat-label">
            Total Visits
          </div>
        </div>
      </div>
    </div>

    <div class="stats-charts">
      <div class="chart-section">
        <h2 class="section-title">
          {{ t('stats.folderDistribution') }}
        </h2>
        <div
          ref="folderChartRef"
          class="chart-container"
        />
      </div>

      <div class="chart-section">
        <h2 class="section-title">
          Bookmarks by Tag
        </h2>
        <div
          ref="tagChartRef"
          class="chart-container"
        />
      </div>
    </div>

    <div class="stats-lists">
      <div class="list-section">
        <h2 class="section-title">
          {{ t('stats.mostVisited') }}
        </h2>
        <div class="list-items">
          <div
            v-for="bookmark in mostVisitedBookmarks"
            :key="bookmark.id"
            class="list-item"
          >
            <div class="list-item-content">
              <div class="list-item-title">
                {{ bookmark.title }}
              </div>
              <div class="list-item-url">
                {{ bookmark.url }}
              </div>
            </div>
            <div class="list-item-count">
              <i class="i-heroicons-chart-bar" />
              {{ bookmark.visitCount || 0 }}
            </div>
          </div>
          <div
            v-if="mostVisitedBookmarks.length === 0"
            class="empty-list"
          >
            No visit data yet
          </div>
        </div>
      </div>

      <div class="list-section">
        <h2 class="section-title">
          Recently Added
        </h2>
        <div class="list-items">
          <div
            v-for="bookmark in recentlyAddedBookmarks"
            :key="bookmark.id"
            class="list-item"
          >
            <div class="list-item-content">
              <div class="list-item-title">
                {{ bookmark.title }}
              </div>
              <div class="list-item-url">
                {{ bookmark.url }}
              </div>
            </div>
            <div class="list-item-date">
              {{ formatDate(bookmark.createdAt) }}
            </div>
          </div>
          <div
            v-if="recentlyAddedBookmarks.length === 0"
            class="empty-list"
          >
            No bookmarks yet
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts'
import { storeToRefs } from 'pinia'
import { useBookmarkStore, useFolderStore, useTagStore } from '../../stores'

const { t } = useI18n()
const bookmarkStore = useBookmarkStore()
const folderStore = useFolderStore()
const tagStore = useTagStore()
const { bookmarks } = storeToRefs(bookmarkStore)
const { folders } = storeToRefs(folderStore)
const { tags } = storeToRefs(tagStore)

const folderChartRef = ref<HTMLElement>()
const tagChartRef = ref<HTMLElement>()
let folderChart: echarts.ECharts | null = null
let tagChart: echarts.ECharts | null = null
let chartResizeObserver: ResizeObserver | null = null
let windowResizeBound = false

// 图表颜色必须由 canvas 消费，无法写在样式里 —— 统一从冻结的 lc 变量读取
const readCssVar = (name: string, fallback: string): string => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

const chartPalette = (): string[] => [
  readCssVar('--lc-accent', '#3b82f6'),
  readCssVar('--lc-success', '#67c23a'),
  readCssVar('--lc-warning', '#e6a23c'),
  readCssVar('--lc-danger', '#f56c6c')
]

const totalBookmarks = computed(() => bookmarks.value.length)
const totalFolders = computed(() => folders.value.length)
const totalTags = computed(() => tags.value.length)
const totalVisits = computed(() => bookmarks.value.reduce((sum, b) => sum + (b.visitCount || 0), 0))

const mostVisitedBookmarks = computed(() => {
  return [...bookmarks.value].sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0)).slice(0, 5)
})

const recentlyAddedBookmarks = computed(() => {
  return [...bookmarks.value]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)
})

const bookmarksByFolder = computed(() => {
  return folders.value.map(folder => ({
    name: folder.name,
    value: bookmarks.value.filter(b => b.folderId === folder.id).length
  }))
})

const bookmarksByTag = computed(() => {
  const data = tags.value.map(tag => ({
    name: tag.name,
    value: bookmarks.value.filter(b => b.tags.includes(tag.id)).length
  }))
  return data.filter(d => d.value > 0)
})

const formatDate = (date: string) => {
  const d = new Date(date)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return t('bookmark.today')
  if (diffDays === 1) return t('bookmark.yesterday')
  if (diffDays < 7) return t('bookmark.daysAgo', { n: diffDays })
  if (diffDays < 30) return t('bookmark.weeksAgo', { n: Math.floor(diffDays / 7) })
  return d.toLocaleDateString()
}

const initFolderChart = () => {
  if (!folderChartRef.value) return

  folderChart = echarts.init(folderChartRef.value)
  const option = {
    color: chartPalette(),
    tooltip: {
      trigger: 'item'
    },
    legend: {
      orient: 'vertical',
      left: 'left'
    },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        data: bookmarksByFolder.value,
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.5)'
          }
        }
      }
    ]
  }
  folderChart.setOption(option)
}

const initTagChart = () => {
  if (!tagChartRef.value) return

  tagChart = echarts.init(tagChartRef.value)
  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow'
      }
    },
    xAxis: {
      type: 'category',
      data: bookmarksByTag.value.map(d => d.name),
      axisLabel: {
        interval: 0,
        rotate: 30
      }
    },
    yAxis: {
      type: 'value'
    },
    series: [
      {
        data: bookmarksByTag.value.map(d => d.value),
        type: 'bar',
        itemStyle: {
          color: readCssVar('--lc-accent', '#3b82f6')
        }
      }
    ]
  }
  tagChart.setOption(option)
}

const updateCharts = () => {
  if (folderChart) {
    folderChart.setOption({
      series: [{ data: bookmarksByFolder.value }]
    })
  }
  if (tagChart) {
    tagChart.setOption({
      xAxis: { data: bookmarksByTag.value.map(d => d.name) },
      series: [{ data: bookmarksByTag.value.map(d => d.value) }]
    })
  }
}

const resizeCharts = () => {
  folderChart?.resize()
  tagChart?.resize()
}

onMounted(() => {
  initFolderChart()
  initTagChart()

  // 容器尺寸变化（窗口缩放、侧栏折叠）比 window.resize 更可靠，且易于释放
  if (typeof ResizeObserver !== 'undefined') {
    chartResizeObserver = new ResizeObserver(() => resizeCharts())
    if (folderChartRef.value) chartResizeObserver.observe(folderChartRef.value)
    if (tagChartRef.value) chartResizeObserver.observe(tagChartRef.value)
  } else {
    window.addEventListener('resize', resizeCharts)
    windowResizeBound = true
  }
})

onUnmounted(() => {
  if (windowResizeBound) {
    window.removeEventListener('resize', resizeCharts)
    windowResizeBound = false
  }
  chartResizeObserver?.disconnect()
  chartResizeObserver = null
  folderChart?.dispose()
  folderChart = null
  tagChart?.dispose()
  tagChart = null
})

watch([bookmarksByFolder, bookmarksByTag], () => {
  updateCharts()
})
</script>

<style scoped>
.stats-view {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.stats-title {
  font-size: var(--lc-font-2xl);
  font-weight: var(--lc-weight-semibold);
  color: var(--lc-text-primary);
  line-height: var(--lc-leading-tight);
  margin: 0 0 var(--lc-space-6);
}

.stats-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--lc-space-4);
  margin-bottom: var(--lc-space-8);
}

.stat-card {
  display: flex;
  align-items: center;
  gap: var(--lc-space-4);
  min-width: 0;
  padding: var(--lc-space-5);
  background-color: var(--lc-bg-surface);
  border: 1px solid var(--lc-border-subtle);
  border-radius: var(--lc-radius-lg);
  box-shadow: var(--lc-shadow-card);
  transition: box-shadow var(--lc-duration-fast) var(--lc-ease-standard);
}

.stat-card:hover {
  box-shadow: var(--lc-shadow-raised);
}

.stat-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border-radius: var(--lc-radius-lg);
  font-size: 28px;
}

.stat-icon.total {
  background-color: color-mix(in srgb, var(--lc-accent) 10%, transparent);
  color: var(--lc-accent);
}

.stat-icon.folders {
  background-color: color-mix(in srgb, var(--lc-success) 10%, transparent);
  color: var(--lc-success);
}

.stat-icon.tags {
  background-color: color-mix(in srgb, var(--lc-warning) 10%, transparent);
  color: var(--lc-warning);
}

.stat-icon.visits {
  background-color: color-mix(in srgb, var(--lc-danger) 10%, transparent);
  color: var(--lc-danger);
}

.stat-content {
  flex: 1;
  min-width: 0;
}

.stat-value {
  font-size: var(--lc-font-2xl);
  font-weight: var(--lc-weight-semibold);
  color: var(--lc-text-primary);
  line-height: var(--lc-leading-tight);
}

.stat-label {
  margin-top: var(--lc-space-1);
  font-size: var(--lc-font-sm);
  color: var(--lc-text-muted);
}

.stats-charts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--lc-space-6);
  margin-bottom: var(--lc-space-8);
}

.chart-section,
.list-section {
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

.chart-container {
  width: 100%;
  height: 300px;
}

.stats-lists {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--lc-space-6);
}

.list-items {
  display: flex;
  flex-direction: column;
  gap: var(--lc-space-3);
}

.list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--lc-space-3);
  padding: var(--lc-space-3);
  background-color: var(--lc-bg-subtle);
  border-radius: var(--lc-radius-md);
  transition: background-color var(--lc-duration-fast) var(--lc-ease-standard);
}

.list-item:hover {
  background-color: var(--lc-bg-hover);
}

.list-item-content {
  flex: 1;
  min-width: 0;
}

.list-item-title {
  font-size: var(--lc-font-base);
  font-weight: var(--lc-weight-medium);
  color: var(--lc-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list-item-url {
  font-size: var(--lc-font-xs);
  color: var(--lc-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list-item-count {
  display: flex;
  align-items: center;
  gap: var(--lc-space-1);
  font-size: var(--lc-font-sm);
  font-weight: var(--lc-weight-medium);
  color: var(--lc-accent);
}

.list-item-date {
  font-size: var(--lc-font-xs);
  color: var(--lc-text-muted);
  white-space: nowrap;
}

.empty-list {
  padding: var(--lc-space-6) var(--lc-space-4);
  text-align: center;
  font-size: var(--lc-font-sm);
  color: var(--lc-text-muted);
}

@media (max-width: 1200px) {
  .stats-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .stats-charts,
  .stats-lists {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 600px) {
  .stats-cards {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
