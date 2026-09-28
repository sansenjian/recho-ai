<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * 就地确认弹窗，替代 window.confirm：原生弹窗会阻塞整个事件循环，
 * 在 KeepAlive 面板里还会丢失焦点上下文，并且没法本地化按钮文案。
 *
 * 用法：触发动作时调用 request()，在 onConfirm 里执行真正的写操作。
 * 中文文案说明：'中文' 仅出现在源码注释中，界面文案全部走 t() 键。
 */
const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 破坏性操作（删除 / 下线）用红色主按钮。 */
  destructive?: boolean
}>(), {
  description: '',
  confirmLabel: '',
  cancelLabel: '',
  destructive: false,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: []
}>()

const { t } = useI18n()

const resolvedConfirmLabel = computed(() => props.confirmLabel || t('common.confirm'))
const resolvedCancelLabel = computed(() => props.cancelLabel || t('common.cancel'))

function cancel() {
  emit('update:open', false)
}

function confirm() {
  emit('update:open', false)
  emit('confirm')
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogHeader>
      <DialogTitle>{{ title }}</DialogTitle>
      <DialogDescription v-if="description">{{ description }}</DialogDescription>
    </DialogHeader>
    <DialogFooter class="mt-6 gap-2">
      <Button type="button" variant="outline" @click="cancel">
        <X class="h-4 w-4" aria-hidden="true" />
        {{ resolvedCancelLabel }}
      </Button>
      <Button
        type="button"
        :variant="destructive ? 'destructive' : 'default'"
        data-slot="confirm-dialog-confirm"
        @click="confirm"
      >
        <Check class="h-4 w-4" aria-hidden="true" />
        {{ resolvedConfirmLabel }}
      </Button>
    </DialogFooter>
  </Dialog>
</template>
