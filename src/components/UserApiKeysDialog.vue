<script setup lang="ts">
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import UserApiKeys from './UserApiKeys.vue'
import { useAuthSession } from '../composables/useAuthSession'

/**
 * 独立 API 密钥弹窗。
 *
 * 密钥原本挂在账号弹窗的资料视图里,必须先登录再翻视图才能看到;
 * 抽成顶栏直接可达的弹窗后,签发/撤销 recho-cli 密钥不再被登录流程挡住。
 */

const props = withDefaults(defineProps<{ open?: boolean }>(), { open: false })

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { t } = useI18n()
const { user } = useAuthSession()

/**
 * 弹窗里可能留着刚签发的一次性明文。身份一旦结束或换人,弹窗必须立刻关闭,
 * 否则同一台机器的下一个人不用重新登录就能读到可用密钥。
 */
watch(() => user.value?.id || null, (nextUserId, previousUserId) => {
  if (props.open && previousUserId && nextUserId !== previousUserId) emit('update:open', false)
})
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
