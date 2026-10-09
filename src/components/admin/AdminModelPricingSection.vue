<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Trash2 } from '@lucide/vue'
import AdminSettingsSection from './AdminSettingsSection.vue'
import type { ModelPriceRow } from '../../utils/admin-runtime-settings'
import { effectiveModelPrice } from '../../utils/admin-runtime-settings'

/**
 * 「按模型定价」区块。
 *
 * 只负责这一张表的增删与取值，定价的清洗规则在 utils/admin-runtime-settings 里，
 * 由父组件在提交时统一调用。
 */
const props = defineProps<{
  /** 可被计费的模型 id，作为输入框的候选。 */
  candidates: readonly string[]
  /** 未单独定价时使用的兜底价。 */
  fallbackPrice: number
}>()

const rows = defineModel<ModelPriceRow[]>({ required: true })

const { t } = useI18n()

const canFill = computed(() => props.candidates.length > 0)

function addRow() {
  // 首次展开时把所有已配置的模型一次补齐，管理员只需改价，不必逐个手打 id。
  if (!rows.value.length) {
    fillFromCandidates()
    if (rows.value.length) return
  }
  rows.value.push({ id: '', cost: props.fallbackPrice })
}

function removeRow(index: number) {
  rows.value.splice(index, 1)
}

function fillFromCandidates() {
  const existing = new Set(rows.value.map(row => row.id.trim()).filter(Boolean))
  for (const id of props.candidates) {
    if (existing.has(id)) continue
    rows.value.push({ id, cost: props.fallbackPrice })
    existing.add(id)
  }
  // 一个候选都没有时也要给出可编辑的一行，否则管理员无从下手。
  if (!rows.value.length) rows.value.push({ id: '', cost: props.fallbackPrice })
}
</script>

<template>
  <AdminSettingsSection
    :title="t('settings.modelPriceTitle')"
    :hint="t('settings.modelPriceHint')"
    :empty="!rows.length"
    :empty-text="t('settings.modelPriceEmpty')"
  >
    <template #actions>
      <Button type="button" variant="outline" size="sm" :disabled="!canFill" @click="fillFromCandidates()">
        {{ t('settings.modelPriceFill') }}
      </Button>
      <Button type="button" variant="outline" size="sm" @click="addRow()">
        <Plus class="mr-1 h-4 w-4" />{{ t('common.add') }}
      </Button>
    </template>

    <div
      v-for="(row, index) in rows"
      :key="index"
      class="grid grid-cols-[minmax(0,1fr)_minmax(0,120px)_auto_auto] items-center gap-2"
    >
      <Input
        :id="`setting-model-price-id-${index}`"
        v-model.trim="row.id"
        :list="`setting-model-price-options-${index}`"
        :placeholder="t('settings.modelPriceIdPlaceholder')"
        class="min-h-8 text-[13px]"
      />
      <datalist :id="`setting-model-price-options-${index}`">
        <option v-for="modelId in candidates" :key="modelId" :value="modelId" />
      </datalist>
      <Input
        :id="`setting-model-price-cost-${index}`"
        v-model.number="row.cost"
        type="number"
        min="0.01"
        step="0.01"
        class="min-h-8 text-[13px]"
      />
      <span class="whitespace-nowrap text-[11px] text-[var(--text-muted)]">
        {{ t('settings.modelPriceEffective', { cost: effectiveModelPrice(row.cost, fallbackPrice) }) }}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        :aria-label="t('settings.providerRemoveModelPriceAria', { index: index + 1 })"
        :title="t('settings.modelPriceRemove')"
        @click="removeRow(index)"
      >
        <Trash2 class="h-4 w-4" />
      </Button>
    </div>
  </AdminSettingsSection>
</template>
