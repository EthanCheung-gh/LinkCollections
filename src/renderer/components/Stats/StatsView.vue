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
            {{ t('stats.totalVisits') }}
          </div>
        </div>
      </div>
    </div>

    <div class="chart-section trend-section">
      <div class="trend-header">
        <h2 class="section-title trend-title">
          {{ t('stats.visitTrend') }}
        </h2>
        <el-radio-group
          v-model="trendRange"
          class="range-switch"
        >
          <el-radio-button :value="7">
            {{ t('stats.range7') }}
          </el-radio-button>
          <el-radio-button :value="30">
            {{ t('stats.range30') }}
          </el-radio-button>
          <el-radio-button :value="90">
            {{ t('stats.range90') }}
          </el-radio-button>
        </el-radio-group>
      </div>
      <!--
        v-show 而不是 v-if：容器必须一直在 DOM 里，ECharts 实例才能在数据到达后
        直接 init / resize（v-if 会让 ref 在被观察期间反复置空）。
        全为 0 时隐藏图表，改为显示一行提示（空图表比一句话更让人困惑）。
      -->
      <div
        v-show="hasTrendData"
        ref="trendChartRef"
        class="chart-container trend-chart"
      />
      <div
        v-if="!hasTrendData"
        class="empty-list"
      >
        {{ t('stats.noHistory') }}
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
          {{ t('stats.byTag') }}
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
          {{ t('stats.recentlyAdded') }}
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
import { useBookmarkStore, useFolderStore, useTagStore, useHistoryStore } from '../../stores'

const { t } = useI18n()
const bookmarkStore = useBookmarkStore()
const folderStore = useFolderStore()
const tagStore = useTagStore()
const historyStore = useHistoryStore()
const { bookmarks } = storeToRefs(bookmarkStore)
const { folders } = storeToRefs(folderStore)
const { tags } = storeToRefs(tagStore)

const folderChartRef = ref<HTMLElement>()
const tagChartRef = ref<HTMLElement>()
const trendChartRef = ref<HTMLElement>()
let folderChart: echarts.ECharts | null = null
let tagChart: echarts.ECharts | null = null
let trendChart: echarts.ECharts | null = null
let chartResizeObserver: ResizeObserver | null = null
let windowResizeBound = false

/** 访问趋势的时间范围（天）。三档固定值，不持久化：进入统计页总是「最近 30 天」。 */
const trendRange = ref<number>(30)

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

/**
 * 趋势数据：按**本地日期**聚合、升序、缺日补 0（实现在 stores/history.ts 的
 * `buildDailySeries`，纯函数，聚合规则不依赖 ECharts）。
 */
const trendPoints = computed(() => historyStore.dailySeries(trendRange.value))

/** 全部为 0 时不画空图表，改显示一行提示文案 */
const hasTrendData = computed(() => trendPoints.value.some(point => point.count > 0))

const formatDate = (date: string) => {
  const d = new Date(date)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return t('bookmark.today')
  if (diffDays === 1) return t('bookmark.yesterday')
  if (diffDays < 7) return t('bookmark.daysAgo', { n: diffDays })
  if (diffDays < 30) return t('bookmark.weeksAgo', { n: Math.floor(diffDays / 7) })

  // 超过 30 天改用固定格式，避免同一列表里「4 周前」与区域化日期（M/D/YYYY）混排。
  // 与 ListView 的最近访问列保持一致：YYYY/MM/DD（本地时区）。
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}/${month}/${day}`
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

/**
 * 折线图 option。
 *
 * 颜色每次都从 `chartPalette()` 现读（canvas 无法消费 CSS 变量）：统计页是
 * `v-else-if` 挂载的视图，切换主题/主题色后重新进入就会读到新值，与既有两个图表
 * （在 init 时读一次）行为一致；范围切换时这里也会重新取色，顺带跟随主题。
 */
const buildTrendOption = () => {
  const accent = chartPalette()[0]
  const points = trendPoints.value

  return {
    color: [accent],
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis'
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      // 直接传 `MM-DD`：ECharts 只要求类目轴上每个点有唯一标签，年份对 7/30/90 天窗口无意义
      data: points.map(point => point.date.slice(5)),
      axisLabel: {
        color: readCssVar('--lc-text-muted', '#8b93a1')
      },
      axisLine: {
        lineStyle: { color: readCssVar('--lc-border-default', '#e3e6eb') }
      }
    },
    yAxis: {
      type: 'value',
      // 访问次数是整数：避免出现 0.2 / 0.4 这种刻度
      minInterval: 1,
      axisLabel: {
        precision: 0,
        color: readCssVar('--lc-text-muted', '#8b93a1')
      },
      splitLine: {
        lineStyle: { color: readCssVar('--lc-border-subtle', '#eef0f3') }
      }
    },
    series: [
      {
        type: 'line',
        name: t('stats.visitTrend'),
        // 刻意不做平滑：平滑会在没有访问的日期之间「编造」起伏，读起来像有数据
        smooth: false,
        showSymbol: false,
        symbolSize: 6,
        data: points.map(point => point.count),
        itemStyle: { color: accent },
        lineStyle: { color: accent, width: 2 },
        // 淡色面积填充用 opacity 表达的（canvas 不吃 color-mix / 变量）
        areaStyle: { color: accent, opacity: 0.15 }
      }
    ]
  }
}

const initTrendChart = () => {
  if (trendChart || !trendChartRef.value) return
  trendChart = echarts.init(trendChartRef.value)
  trendChart.setOption(buildTrendOption())
  // 数据比挂载晚到（fetchHistory 是异步的）时才走到这里，
  // 因此需要补一次 observe —— onMounted 里的观察只覆盖「挂载时已有数据」的情况。
  if (chartResizeObserver && trendChartRef.value) {
    chartResizeObserver.observe(trendChartRef.value)
  }
}

const updateTrendChart = () => {
  if (!trendChart) return
  // 整份 option 覆盖（而不是只改 series）：颜色/轴颜色都依赖 CSS 变量，
  // 每次更新重新读取即可跟随主题，代价可以忽略（最多 90 个点）。
  trendChart.setOption(buildTrendOption())
}

const resizeCharts = () => {
  folderChart?.resize()
  tagChart?.resize()
  // 趋势图可能在数据到达后才创建，resize 必须容忍 null
  trendChart?.resize()
}

onMounted(() => {
  initFolderChart()
  initTagChart()
  // 挂载时如果 store 里已有历史（从其它视图切回来），直接建图；否则等 watch 里的数据到达
  if (hasTrendData.value) initTrendChart()

  // 容器尺寸变化（窗口缩放、侧栏折叠）比 window.resize 更可靠，且易于释放
  if (typeof ResizeObserver !== 'undefined') {
    chartResizeObserver = new ResizeObserver(() => resizeCharts())
    if (folderChartRef.value) chartResizeObserver.observe(folderChartRef.value)
    if (tagChartRef.value) chartResizeObserver.observe(tagChartRef.value)
    if (trendChart && trendChartRef.value) chartResizeObserver.observe(trendChartRef.value)
  } else {
    window.addEventListener('resize', resizeCharts)
    windowResizeBound = true
  }

  // 历史数据独立拉取：失败只提示一次（store 内部 catch），不阻塞其它统计
  void historyStore.fetchHistory()
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
  trendChart?.dispose()
  trendChart = null
})

watch([bookmarksByFolder, bookmarksByTag], () => {
  updateCharts()
})

/**
 * `flush: 'post'` 是必需的：`hasTrendData` 翻转后容器的 `v-show` 才会变成可见，
 * 若在默认的 pre 阶段 init，ECharts 会拿到一个 `display:none`（0×0）的容器并报错。
 */
watch(
  trendPoints,
  () => {
    if (hasTrendData.value) {
      initTrendChart()
      updateTrendChart()
    }
  },
  { flush: 'post' }
)
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

/* ---------- 访问趋势 ---------- */

.trend-section {
  margin-bottom: var(--lc-space-8);
}

.trend-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--lc-space-4);
  margin-bottom: var(--lc-space-4);
  padding-bottom: var(--lc-space-3);
  border-bottom: 1px solid var(--lc-border-subtle);
}

/* 标题在下划线之外，与范围切换同一行：压掉 .section-title 自带的下划线与外边距 */
.trend-header .section-title {
  margin: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.trend-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 只覆盖尺寸，不覆盖颜色：EP 的选中/未选中配色已经跟随 --el-color-primary（被 ui store
 * 与设置页同步成主题色）与深色变量，与 SettingsView / ImportExport 的写法保持一致 ——
 * 抢 EP 的配色会把选中态压成未选中（scoped 属性选择器让权重打平、组件样式后加载）。
 */
.range-switch :deep(.el-radio-button__inner) {
  display: inline-flex;
  align-items: center;
  height: var(--lc-control-md);
  padding: 0 var(--lc-space-3);
  font-size: var(--lc-font-sm);
}

.trend-chart {
  height: 280px;
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
