<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Trash2 } from '@lucide/vue'
import AdminSettingsSection from './AdminSettingsSection.vue'
import type { VisibleModelRow } from '../../utils/admin-runtime-settings'
import { fillRows } from '../../utils/admin-runtime-settings'

/**
 * 「用户可见模型」区块。
 *
 * 控制前台生成面板里能选到哪些模型。留空表示跟随已启用 Provider，因此空态不是
 * 错误状态，只是一条说明。
 */
const props = defineProps<{
  /** 已启用 Provider 真正能出图的模型 id，同时用作可用性判据与输入候选。 */
  availableIds: readonly string[]
}>()

const rows = defineModel<VisibleModelRow[]>({ required: true })

const { t } = useI18n()

/**
 * 宽屏下的列宽：模型 ID、展示名、删除按钮。
 *
 * 窄屏放不下这些固定宽度，由模板上的 max-sm: 类切成单列；这里只负责宽屏形态。
 */
const wideRowStyle = 'grid-template-columns: minmax(180px, 320px) minmax(160px, 280px) 32px;'

function isAvailable(modelId: string) {
  return props.availableIds.includes(modelId.trim())
}

function addRow() {
  // 空表时先带入所有已启用模型，管理员按需删减而不是逐个手打。
  if (!rows.value.length) fillFromAvailable()
  // 无论上面是否补到了候选，都要保证这一次点击真的加出一行：
  // - 没有候选可补（例如一个 Provider 都没启用）时给一个空行让管理员手填；
  // - 已经有条目时同样追加空行，否则「添加」在非空表上毫无反应。
  rows.value.push({ id: '', name: '', supportsTransparent: false })
}

function removeRow(index: number) {
  rows.value.splice(index, 1)
}

function fillFromAvailable() {
  fillRows(rows.value, props.availableIds, id => ({ id, name: '', supportsTransparent: false }))
}
</script>

<template>
  <AdminSettingsSection
    :title="t('settings.visibleModelsTitle')"
    :hint="t('settings.visibleModelsHint')"
    :empty="!rows.length"
    :empty-text="t('settings.visibleModelsEmpty')"
  >
    <template #actions>
      <Button type="button" variant="outline" size="sm" :disabled="!availableIds.length" @click="fillFromAvailable()">
        {{ t('settings.visibleModelsFill') }}
      </Button>
      <Button type="button" variant="outline" size="sm" @click="addRow()">
        <Plus class="mr-1 h-4 w-4" />{{ t('common.add') }}
      </Button>
    </template>

    <!--
      宽屏用固定列宽，与定价表右对齐在同一条竖线上（纯 1fr 会把两列各撑到半屏）。
      窄屏放不下 180+160+32 这三列，改为单列堆叠；否则网格横向溢出，删除按钮会
      被推到可视区域之外，点不到。
    -->
    <div v-for="(row, index) in rows" :key="index" class="flex flex-col gap-1">
      <div class="grid items-center gap-2 max-sm:grid-cols-[minmax(0,1fr)_32px]" :style="wideRowStyle">
        <Input
          :id="`setting-visible-model-id-${index}`"
          v-model.trim="row.id"
          :list="`setting-visible-model-options-${index}`"
          :placeholder="t('settings.modelPriceIdPlaceholder')"
          class="min-h-8 text-[13px]"
        />
        <datalist :id="`setting-visible-model-options-${index}`">
          <option v-for="modelId in availableIds" :key="modelId" :value="modelId" />
        </datalist>
        <Input
          :id="`setting-visible-model-name-${index}`"
          v-model.trim="row.name"
          :placeholder="t('settings.visibleModelsNamePlaceholder')"
          class="min-h-8 text-[13px]"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          :aria-label="t('settings.visibleModelsRemoveAria', { index: index + 1 })"
          :title="t('settings.visibleModelsRemove')"
          @click="removeRow(index)"
        >
          <Trash2 class="h-4 w-4" />
        </Button>
      </div>
      <span v-if="row.id.trim() && !isAvailable(row.id)" class="text-[11px] text-[var(--text-muted)]">
        {{ t('settings.visibleModelsUnavailable') }}
      </span>
    </div>
  </AdminSettingsSection>
</template>
