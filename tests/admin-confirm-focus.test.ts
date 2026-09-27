// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import ConfirmDialog from '../src/components/admin/ConfirmDialog.vue'
import { en } from '../src/i18n/en'
import { zh } from '../src/i18n/zh'

function mountDialog(open: boolean) {
  return mount(ConfirmDialog, {
    props: { open, title: '确认归档', description: '将归档 2 张', confirmLabel: '归档', cancelLabel: '取消' },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh', fallbackLocale: 'en', messages: { en, zh } })] },
    attachTo: document.body,
  })
}

describe('ConfirmDialog focus management', () => {
  it('moves focus into the dialog and restores it on close', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = '归档'
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const wrapper = mountDialog(true)
    await new Promise(resolve => setTimeout(resolve, 0))

    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(dialog).not.toBeNull()
    // 焦点必须已经离开触发控件，进入对话框内部。
    expect(dialog.contains(document.activeElement)).toBe(true)

    await wrapper.setProps({ open: false })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(document.activeElement).toBe(trigger)

    wrapper.unmount()
    trigger.remove()
  })

  it('keeps Tab cycling inside the dialog', async () => {
    const wrapper = mountDialog(true)
    await new Promise(resolve => setTimeout(resolve, 0))
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement
    const buttons = dialog.querySelectorAll<HTMLElement>('button')
    expect(buttons.length).toBeGreaterThanOrEqual(2)

    const last = buttons[buttons.length - 1]
    last.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(buttons[0])

    const first = buttons[0]
    first.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    expect(document.activeElement).toBe(last)

    wrapper.unmount()
  })
})
