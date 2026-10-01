<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import UserApiKeys from './UserApiKeys.vue'

/**
 * 独立 API 密钥弹窗。
 *
 * 密钥原本挂在账号弹窗的资料视图里,必须先登录再翻视图才能看到;
 * 抽成顶栏直接可达的弹窗后,签发/撤销 recho-cli 密钥不再被登录流程挡住。
 */

withDefaults(defineProps<{ open?: boolean }>(), { open: false })

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { t } = useI18n()
</script>

<template>
  <Dialog
    :open="open"
    class="max-w-xl"
    @update:open="emit('update:open', $event)"
  >
    <DialogHeader>
      <DialogTitle>{{ t('account.keys.title') }}</DialogTitle>
      <DialogDescription>{{ t('account.keys.description') }}</DialogDescription>
    </DialogHeader>

    <div class="mt-5" data-slot="api-keys-dialog">
      <UserApiKeys />
    </div>
  </Dialog>
</template>
