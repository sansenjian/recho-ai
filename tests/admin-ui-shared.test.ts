// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import AdminStatusBanner from '../src/components/admin/AdminStatusBanner.vue'
import AdminIdentityCard from '../src/components/admin/AdminIdentityCard.vue'
import ConfirmDialog from '../src/components/admin/ConfirmDialog.vue'
import { useConfirmAction } from '../src/composables/useConfirmAction'
import en from '../src/i18n/en'
import zh from '../src/i18n/zh'

function makeI18n(locale: 'zh' | 'en' = 'zh') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { en, zh } })
}

const mounted: Array<{ unmount: () => void }> = []

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
  document.body.innerHTML = ''
})

function mountWith(component: unknown, props: Record<string, unknown> = {}, locale: 'zh' | 'en' = 'zh') {
  const wrapper = mount(component as never, {
    props,
    global: { plugins: [makeI18n(locale)] },
    // Dialog.vue 把内容 Teleport 到 body，所以必须 attachTo，否则查询拿到空节点。
    attachTo: document.body,
  })
  mounted.push(wrapper)
  return wrapper
}

/** Teleport 之后按钮不在 wrapper 的子树里，只能查真实 DOM。 */
function buttonsIn(selector = '[role="dialog"]') {
  const dialog = document.querySelector(selector)
  if (!dialog) throw new Error(`dialog not found: ${selector}`)
  return Array.from(dialog.querySelectorAll('button'))
}

function clickButton(label: string) {
  const button = buttonsIn().find(item => item.textContent?.includes(label))
  if (!button) throw new Error(`button not found: ${label}`)
  button.click()
}

describe('AdminStatusBanner', () => {
  it('renders nothing when there is neither an error nor a notice', () => {
    const wrapper = mountWith(AdminStatusBanner)
    expect(wrapper.find('[data-slot="admin-status-banner"]').exists()).toBe(false)
  })

  it('prefers the error tone when both messages are present', () => {
    const wrapper = mountWith(AdminStatusBanner, { error: 'boom', notice: 'saved' })
    const banner = wrapper.find('[data-slot="admin-status-banner"]')
    expect(banner.attributes('data-tone')).toBe('error')
    expect(banner.text()).toBe('boom')
    expect(banner.classes()).toContain('mb-2')
    expect(banner.classes()).toContain('bg-danger/10')
  })

  it('falls back to the notice tone and drops the bottom margin when flushed', () => {
    const wrapper = mountWith(AdminStatusBanner, { notice: 'saved', flush: true })
    const banner = wrapper.find('[data-slot="admin-status-banner"]')
    expect(banner.attributes('data-tone')).toBe('notice')
    expect(banner.classes()).toContain('bg-success/10')
    expect(banner.classes()).not.toContain('mb-2')
  })

  it('announces updates to assistive technology', () => {
    const wrapper = mountWith(AdminStatusBanner, { error: 'boom' })
    expect(wrapper.find('[aria-live="polite"]').exists()).toBe(true)
  })
})

describe('AdminIdentityCard', () => {
  it('renders the initial, email and localized senior role', () => {
    const wrapper = mountWith(AdminIdentityCard, { email: 'ada@example.test', role: 'senior' })
    expect(wrapper.text()).toContain('A')
    expect(wrapper.text()).toContain('ada@example.test')
    expect(wrapper.text()).toContain('高级管理员')
  })

  it('follows the active locale for the operator role', () => {
    const wrapper = mountWith(AdminIdentityCard, { email: 'ops@example.test', role: 'operator' }, 'en')
    expect(wrapper.text()).toContain('Operator')
    expect(wrapper.find('[data-slot="admin-identity-role"]').text()).toBe('Operator')
  })

  it('hides itself when the sidebar is collapsed', () => {
    const wrapper = mountWith(AdminIdentityCard, { email: 'ada@example.test', role: 'senior', collapsed: true })
    expect(wrapper.find('[data-slot="admin-identity-card"]').exists()).toBe(false)
  })
})

describe('ConfirmDialog', () => {
  it('closes itself and reports the confirmation', async () => {
    const wrapper = mountWith(ConfirmDialog, {
      open: true,
      title: '停用兑换码',
      description: '停用后无法再被兑换。',
      confirmLabel: '停用兑换码',
      destructive: true,
    })
    clickButton('停用兑换码')
    await nextTick()
    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('closes without confirming when cancelled', async () => {
    const wrapper = mountWith(ConfirmDialog, { open: true, title: '停用兑换码' })
    clickButton('取消')
    await nextTick()
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('falls back to the localized default labels', () => {
    mountWith(ConfirmDialog, { open: true, title: 'Disable code' }, 'en')
    const labels = buttonsIn().map(button => button.textContent?.trim())
    expect(labels).toContain('Cancel')
    expect(labels).toContain('Confirm')
  })

  it('renders no dialog at all while closed', () => {
    mountWith(ConfirmDialog, { open: false, title: '停用兑换码' })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe('useConfirmAction', () => {
  it('defers the action until the dialog is confirmed', async () => {
    const Harness = defineComponent({
      setup() {
        const runs = ref(0)
        const ask = useConfirmAction()
        return { runs, ask }
      },
      render() {
        const self = this as unknown as { runs: number; ask: ReturnType<typeof useConfirmAction> }
        return h('div', [
          h('button', { 'data-slot': 'ask', onClick: () => self.ask.request(() => { self.runs += 1 }) }, 'ask'),
          h(ConfirmDialog, {
            open: self.ask.open.value,
            title: 'title',
            confirmLabel: 'go',
            'onUpdate:open': (value: boolean) => { self.ask.open.value = value },
            onConfirm: () => self.ask.confirm(),
          }),
        ])
      },
    })

    const wrapper = mount(Harness, { global: { plugins: [makeI18n()] }, attachTo: document.body })
    mounted.push(wrapper)
    ;(wrapper.vm as unknown as { ask: { request: (fn: () => void) => void } })
    const vm = wrapper.vm as unknown as { runs: number; ask: ReturnType<typeof useConfirmAction> }

    vm.ask.request(() => { vm.runs += 1 })
    await nextTick()
    expect(vm.ask.open.value).toBe(true)
    expect(vm.runs).toBe(0)

    clickButton('go')
    await nextTick()
    expect(vm.runs).toBe(1)
    expect(vm.ask.open.value).toBe(false)
  })

  it('does not run the stored action twice', () => {
    const runs: number[] = []
    const { request, confirm, open } = useConfirmAction()
    request(() => runs.push(1))
    expect(open.value).toBe(true)
    confirm()
    confirm()
    expect(runs).toEqual([1])
  })

  it('returns false from request so callers can early-return', () => {
    const { request } = useConfirmAction()
    expect(request(() => {})).toBe(false)
  })
})
