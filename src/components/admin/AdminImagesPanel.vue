<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { AdminImageItem } from '../../types/admin'
import {
  dateTime,
  imageDetails,
  imageFundingLabel,
  imagePreviewSrc,
  imageVisibilityLabel,
  shortId,
  storageLocationLabel,
  storageLocationClass,
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
  <section class="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)] p-4 max-w-[1360px] mx-auto mb-3.5" aria-label="作品管理">
    <div class="flex items-start justify-between gap-2.5 mb-3 max-[680px]:flex-col max-[680px]:items-start">
      <div>
        <span class="block text-sm">作品管理</span>
        <strong class="block mt-0.5 text-lg">{{ images.length }}</strong>
      </div>
      <form class="flex items-center justify-end gap-2 flex-wrap max-[680px]:justify-start max-[680px]:w-full" @submit.prevent="emit('refresh')">
        <select
          :value="visibilityFilter"
          :disabled="loading"
          class="min-h-9 min-w-[130px] cursor-pointer rounded-md border border-[var(--border)] bg-[var(--input-bg)] text-[var(--text-primary)] px-2 py-1.5 text-sm"
          @change="updateVisibilityFilter"
        >
          <option value="">全部状态</option>
          <option value="public">公开</option>
          <option value="private">已隐藏</option>
        </select>
        <select
          :value="fundingFilter"
          :disabled="loading"
          class="min-h-9 min-w-[130px] cursor-pointer rounded-md border border-[var(--border)] bg-[var(--input-bg)] text-[var(--text-primary)] px-2 py-1.5 text-sm"
          @change="updateFundingFilter"
        >
          <option value="">全部来源</option>
          <option value="free">免费</option>
          <option value="credit">额度</option>
        </select>
        <input
          :value="userFilter"
          type="search"
          placeholder="用户 ID"
          :disabled="loading"
          class="min-h-9 w-[180px] min-w-[140px] rounded-md border border-[var(--border)] bg-[var(--input-bg)] text-[var(--text-primary)] px-2 py-1.5 text-sm"
          @input="updateUserFilter"
        >
        <input
          :value="query"
          type="search"
          placeholder="提示词"
          :disabled="loading"
          class="min-h-9 w-[180px] min-w-[140px] rounded-md border border-[var(--border)] bg-[var(--input-bg)] text-[var(--text-primary)] px-2 py-1.5 text-sm"
          @input="updateQuery"
        >
        <Button type="submit" variant="outline" size="sm" :disabled="loading">筛选</Button>
        <Button type="button" variant="outline" size="sm" :disabled="loading" @click="emit('refresh')">刷新</Button>
      </form>
    </div>

    <div class="flex items-center justify-start gap-2 flex-wrap mb-2.5">
      <span class="text-xs font-extrabold text-[var(--text-secondary)]">已选 {{ selectedCount }}</span>
      <Button type="button" variant="outline" size="sm" :disabled="bulkLoading || selectedCount === 0" @click="emit('bulkArchive')">批量归档</Button>
      <Button type="button" variant="destructive" size="sm" :disabled="bulkLoading || selectedCount === 0" @click="emit('bulkDelete')">批量删除</Button>
    </div>

    <div class="w-full overflow-auto rounded-lg border border-[var(--border)] max-h-[560px]">
      <table class="w-full border-collapse text-[13px] min-w-[1360px]">
        <thead>
          <tr>
            <th class="w-[42px] text-center px-2.5 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-xs font-extrabold border-b border-[var(--border)]">
              <input
                type="checkbox"
                :checked="allVisibleSelected"
                :disabled="loading || !images.length"
                aria-label="选择当前列表"
                class="w-4 h-4"
                @change="toggleAll"
              >
            </th>
            <th class="text-left px-2.5 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-xs font-extrabold border-b border-[var(--border)]">预览</th>
            <th class="text-left px-2.5 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-xs font-extrabold border-b border-[var(--border)]">时间</th>
            <th class="text-left px-2.5 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-xs font-extrabold border-b border-[var(--border)]">用户</th>
            <th class="text-left px-2.5 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-xs font-extrabold border-b border-[var(--border)]">状态</th>
            <th class="text-left px-2.5 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-xs font-extrabold border-b border-[var(--border)]">来源</th>
            <th class="text-left px-2.5 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-xs font-extrabold border-b border-[var(--border)]">存储</th>
            <th class="text-left px-2.5 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-xs font-extrabold border-b border-[var(--border)]">模型</th>
            <th class="text-left px-2.5 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-xs font-extrabold border-b border-[var(--border)]">参数</th>
            <th class="text-left px-2.5 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-xs font-extrabold border-b border-[var(--border)]">提示词</th>
            <th class="text-left px-2.5 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-xs font-extrabold border-b border-[var(--border)]">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="image in images" :key="image.id" class="border-b border-[var(--border)]">
            <td class="w-[42px] text-center px-2.5 py-2 align-middle">
              <input
                type="checkbox"
                :checked="selectedSet.has(image.id)"
                :disabled="loading"
                :aria-label="`选择 ${image.id}`"
                class="w-4 h-4"
                @change="toggleImage(image.id, $event)"
              >
            </td>
            <td class="px-2.5 py-2 align-middle">
              <img v-if="imagePreviewSrc(image)" class="block w-16 h-16 object-cover rounded-md border border-[var(--border)] bg-[var(--surface-soft)]" :src="imagePreviewSrc(image)" alt="">
              <span v-else class="grid place-items-center w-16 h-16 rounded-md border border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text-secondary)] text-xs font-extrabold">无图</span>
            </td>
            <td class="px-2.5 py-2 align-middle">{{ dateTime(image.generatedAt) }}</td>
            <td class="px-2.5 py-2 align-middle">{{ image.email || (image.userId ? shortId(image.userId) : '-') }}</td>
            <td class="px-2.5 py-2 align-middle">
              <Badge variant="outline">{{ imageVisibilityLabel(image.visibility) }}</Badge>
            </td>
            <td class="px-2.5 py-2 align-middle">
              <Badge variant="secondary">{{ imageFundingLabel(image) }}</Badge>
            </td>
            <td :class="['flex flex-col gap-0.5 px-2.5 py-2 align-middle', storageLocationClass(image.storageLocation)]">
              <span class="text-xs font-bold">{{ storageLocationLabel(image.storageLocation) }}</span>
              <span v-if="image.storagePath" class="text-[11px] text-[var(--text-secondary)]">{{ shortId(image.storagePath) }}</span>
            </td>
            <td class="px-2.5 py-2 align-middle text-xs text-[var(--text-secondary)]">{{ image.imageModel || '-' }}</td>
            <td class="px-2.5 py-2 align-middle">{{ imageDetails(image) }}</td>
            <td class="px-2.5 py-2 align-middle max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap">{{ image.prompt || '-' }}</td>
            <td class="px-2.5 py-2 align-middle">
              <Button
                v-if="image.visibility === 'public'"
                type="button"
                variant="ghost"
                size="sm"
                :disabled="actionId === image.id"
                @click="emit('setVisibility', image, 'private')"
              >
                隐藏
              </Button>
              <Button
                v-else-if="image.fundingSource !== 'credit'"
                type="button"
                variant="ghost"
                size="sm"
                :disabled="actionId === image.id"
                @click="emit('setVisibility', image, 'public')"
              >
                公开
              </Button>
              <span v-else class="text-xs font-extrabold text-[var(--text-secondary)]">私有</span>
            </td>
          </tr>
          <tr v-if="!images.length">
            <td colspan="11" class="px-2.5 py-2 text-center">暂无作品</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
