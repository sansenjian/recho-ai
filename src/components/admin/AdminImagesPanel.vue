<script setup lang="ts">
import { computed } from 'vue'
import type { AdminImageItem } from '../../types/admin'
import {
  dateTime,
  imageDetails,
  imageFundingLabel,
  imagePreviewSrc,
  imageVisibilityLabel,
  shortId,
} from '../../utils/admin-format'

const props = defineProps<{
  images: AdminImageItem[]
  loading: boolean
  bulkLoading: boolean
  actionId: string | null
  selectedIds: string[]
  visibilityFilter: string
  fundingFilter: string
  userFilter: string
  query: string
}>()

const emit = defineEmits<{
  refresh: []
  bulkArchive: []
  bulkDelete: []
  setVisibility: [image: AdminImageItem, visibility: AdminImageItem['visibility']]
  'update:selectedIds': [ids: string[]]
  'update:visibilityFilter': [value: string]
  'update:fundingFilter': [value: string]
  'update:userFilter': [value: string]
  'update:query': [value: string]
}>()

const selectedSet = computed(() => new Set(props.selectedIds))
const visibleIds = computed(() => props.images.map(image => image.id))
const selectedCount = computed(() => props.selectedIds.length)
const allVisibleSelected = computed(() => (
  visibleIds.value.length > 0
  && visibleIds.value.every(id => selectedSet.value.has(id))
))

function targetValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLSelectElement).value
}

function updateVisibilityFilter(event: Event) {
  emit('update:visibilityFilter', targetValue(event))
  emit('refresh')
}

function updateFundingFilter(event: Event) {
  emit('update:fundingFilter', targetValue(event))
  emit('refresh')
}

function updateUserFilter(event: Event) {
  emit('update:userFilter', targetValue(event))
}

function updateQuery(event: Event) {
  emit('update:query', targetValue(event))
}

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  if (checked) {
    emit('update:selectedIds', Array.from(new Set([...props.selectedIds, ...visibleIds.value])))
    return
  }
  const visible = new Set(visibleIds.value)
  emit('update:selectedIds', props.selectedIds.filter(id => !visible.has(id)))
}

function toggleImage(id: string, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  if (checked) {
    emit('update:selectedIds', Array.from(new Set([...props.selectedIds, id])))
    return
  }
  emit('update:selectedIds', props.selectedIds.filter(selectedId => selectedId !== id))
}
</script>

<template>
  <section class="admin-panel images-panel" aria-label="作品管理">
    <div class="panel-header image-header">
      <div>
        <span>作品管理</span>
        <strong>{{ images.length }}</strong>
      </div>
      <form class="image-controls" @submit.prevent="emit('refresh')">
        <select :value="visibilityFilter" :disabled="loading" @change="updateVisibilityFilter">
          <option value="">全部状态</option>
          <option value="public">公开</option>
          <option value="private">已隐藏</option>
        </select>
        <select :value="fundingFilter" :disabled="loading" @change="updateFundingFilter">
          <option value="">全部来源</option>
          <option value="free">免费</option>
          <option value="credit">额度</option>
        </select>
        <input :value="userFilter" type="search" placeholder="用户 ID" :disabled="loading" @input="updateUserFilter">
        <input :value="query" type="search" placeholder="提示词" :disabled="loading" @input="updateQuery">
        <button type="submit" :disabled="loading">筛选</button>
        <button type="button" :disabled="loading" @click="emit('refresh')">刷新</button>
      </form>
    </div>

    <div class="bulk-row">
      <span>已选 {{ selectedCount }}</span>
      <button type="button" :disabled="bulkLoading || selectedCount === 0" @click="emit('bulkArchive')">批量归档</button>
      <button type="button" class="danger-action" :disabled="bulkLoading || selectedCount === 0" @click="emit('bulkDelete')">批量删除</button>
    </div>

    <div class="table-wrap image-table-wrap">
      <table class="image-table">
        <thead>
          <tr>
            <th class="select-cell">
              <input
                type="checkbox"
                :checked="allVisibleSelected"
                :disabled="loading || !images.length"
                aria-label="选择当前列表"
                @change="toggleAll"
              >
            </th>
            <th>预览</th>
            <th>时间</th>
            <th>用户</th>
            <th>状态</th>
            <th>来源</th>
            <th>参数</th>
            <th>提示词</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="image in images" :key="image.id">
            <td class="select-cell">
              <input
                type="checkbox"
                :checked="selectedSet.has(image.id)"
                :disabled="loading"
                :aria-label="`选择 ${image.id}`"
                @change="toggleImage(image.id, $event)"
              >
            </td>
            <td>
              <img v-if="imagePreviewSrc(image)" class="image-thumb" :src="imagePreviewSrc(image)" alt="">
              <span v-else class="image-thumb empty">无图</span>
            </td>
            <td>{{ dateTime(image.generatedAt) }}</td>
            <td>{{ image.email || (image.userId ? shortId(image.userId) : '-') }}</td>
            <td>{{ imageVisibilityLabel(image.visibility) }}</td>
            <td>{{ imageFundingLabel(image) }}</td>
            <td>{{ imageDetails(image) }}</td>
            <td class="prompt-cell">{{ image.prompt || '-' }}</td>
            <td>
              <button
                v-if="image.visibility === 'public'"
                type="button"
                class="table-action"
                :disabled="actionId === image.id"
                @click="emit('setVisibility', image, 'private')"
              >
                隐藏
              </button>
              <button
                v-else-if="image.fundingSource !== 'credit'"
                type="button"
                class="table-action"
                :disabled="actionId === image.id"
                @click="emit('setVisibility', image, 'public')"
              >
                公开
              </button>
              <span v-else class="table-muted">私有</span>
            </td>
          </tr>
          <tr v-if="!images.length">
            <td colspan="9">暂无作品</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.admin-panel {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.images-panel {
  max-width: 1360px;
  margin: 0 auto 14px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.image-header {
  align-items: flex-start;
}

.panel-header strong {
  display: block;
  margin-top: 2px;
  font-size: 18px;
}

.image-controls,
.bulk-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.bulk-row {
  justify-content: flex-start;
  margin-bottom: 10px;
}

.bulk-row span,
.table-muted {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
}

input,
select {
  width: 100%;
  min-height: 36px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--input-bg);
  color: var(--text-primary);
  padding: 7px 9px;
}

select {
  min-width: 130px;
  cursor: pointer;
}

.image-controls input {
  width: 180px;
  min-width: 140px;
}

button {
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 800;
  text-decoration: none;
  cursor: pointer;
}

button:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--hover-bg);
}

button:disabled {
  opacity: 0.55;
  cursor: default;
}

.danger-action {
  color: var(--danger);
}

.table-wrap {
  width: 100%;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.image-table-wrap {
  max-height: 560px;
}

.image-table {
  min-width: 1120px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th,
td {
  padding: 9px 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: middle;
}

th {
  background: var(--surface-soft);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
}

tbody tr:last-child td {
  border-bottom: 0;
}

.select-cell {
  width: 42px;
  text-align: center;
}

.select-cell input {
  width: 16px;
  min-height: 16px;
  padding: 0;
}

.image-thumb {
  display: block;
  width: 64px;
  height: 64px;
  object-fit: cover;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
}

.image-thumb.empty {
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
}

.prompt-cell {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 680px) {
  .panel-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .image-controls {
    justify-content: flex-start;
    width: 100%;
  }
}
</style>
