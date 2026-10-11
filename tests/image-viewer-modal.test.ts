// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ImageViewerModal from '../src/components/ImageViewerModal.vue'

function mountViewer(overrides: Record<string, unknown> = {}) {
  return mount(ImageViewerModal, {
    props: {
      viewer: {
        imageUrl: '',
        storagePath: 'supabase://x.png',
        title: 'a_dot',
        caption: 'a dot',
        zoom: 1,
      },
      isDownloading: false,
      total: 1,
      index: 0,
      ...overrides,
    },
    global: {
      stubs: { AuthenticatedImage: { template: '<img />' }, Teleport: true },
    },
  })
}

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

describe('ImageViewerModal keyboard', () => {
  it('closes on Escape', async () => {
    // 看图时手在键盘上，没有 Esc 就只能伸鼠标点右上角的 X。
    const w = mountViewer()
    press('Escape')
    await w.vm.$nextTick()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('zooms with plus and minus', async () => {
    const w = mountViewer()
    press('+')
    press('-')
    await w.vm.$nextTick()
    expect(w.emitted('zoom')).toEqual([[0.12], [-0.12]])
  })

  it('resets zoom with 0', async () => {
    const w = mountViewer()
    press('0')
    await w.vm.$nextTick()
    expect(w.emitted('reset-zoom')).toHaveLength(1)
  })

  it('pages with arrow keys only when there is more than one image', async () => {
    const single = mountViewer()
    press('ArrowRight')
    press('ArrowLeft')
    await single.vm.$nextTick()
    // 单张时不该翻页，也不该拦掉浏览器的默认行为。
    expect(single.emitted('next')).toBeUndefined()
    expect(single.emitted('previous')).toBeUndefined()

    const multi = mountViewer({ total: 3 })
    press('ArrowRight')
    press('ArrowLeft')
    await multi.vm.$nextTick()
    expect(multi.emitted('next')).toHaveLength(1)
    expect(multi.emitted('previous')).toHaveLength(1)
  })

  it('ignores shortcuts that carry a modifier key', async () => {
    // Ctrl/Cmd + 是浏览器的页面缩放，不该被图片缩放吃掉。
    const w = mountViewer()
    for (const key of ['+', '-', '0']) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true }))
    }
    await w.vm.$nextTick()
    expect(w.emitted('zoom')).toBeUndefined()
    expect(w.emitted('reset-zoom')).toBeUndefined()
  })

  it('stops listening after unmount', async () => {
    const w = mountViewer()
    w.unmount()
    press('Escape')
    // 卸载后再按键不该触发已销毁组件的事件。
    expect(w.emitted('close')).toBeUndefined()
  })
})

describe('ImageViewerModal paging hint', () => {
  it('shows no position hint for a single image', () => {
    const w = mountViewer()
    expect(w.text()).not.toContain('/')
    expect(w.find('[aria-label="上一张"]').exists()).toBe(false)
  })

  it('shows the position and paging buttons for a batch', () => {
    // 多图时要知道自己在第几张，也要能直接翻——不必关掉再点下一张。
    const w = mountViewer({ total: 3, index: 1 })
    expect(w.text()).toContain('2 / 3')
    expect(w.find('[aria-label="上一张"]').exists()).toBe(true)
    expect(w.find('[aria-label="下一张"]').exists()).toBe(true)
  })

  it('emits previous and next from the side buttons', async () => {
    const w = mountViewer({ total: 2 })
    await w.find('[aria-label="下一张"]').trigger('click')
    await w.find('[aria-label="上一张"]').trigger('click')
    expect(w.emitted('next')).toHaveLength(1)
    expect(w.emitted('previous')).toHaveLength(1)
  })
})

describe('ImageViewerModal zoom sizing', () => {
  it('sizes the image instead of only capping it', async () => {
    // max-width 只限制上限：一张小于视口的图，无论百分比怎么调都不会变大，
    // 放大按钮看上去毫无反应。
    const w = mountViewer()
    const style = () => w.find('img').attributes('style') ?? ''
    expect(style()).toContain('width: 100%')
    expect(style()).not.toContain('max-width')

    await w.setProps({ viewer: { ...w.props('viewer'), zoom: 2 } })
    expect(style()).toContain('width: 200%')
  })
})

describe('ImageViewerModal pan', () => {
  /**
   * jsdom 的 MouseEvent.button 是只读的，test-utils 的 trigger 无法设置它，
   * 所以手动派发一个补齐了指针字段的事件。
   */
  function pointerEvent(type: string, init: { button?: number; clientX: number; clientY: number }) {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperties(event, {
      button: { value: init.button ?? 0 },
      clientX: { value: init.clientX },
      clientY: { value: init.clientY },
      pointerId: { value: 1 },
    })
    return event
  }

  function prepare(stage: ReturnType<ReturnType<typeof mountViewer>['find']>) {
    const el = stage.element as HTMLElement
    el.setPointerCapture = vi.fn()
    el.hasPointerCapture = vi.fn(() => false)
    el.releasePointerCapture = vi.fn()
    return el
  }

  it('shifts the image while dragging', async () => {
    // 放大后图片超出视野，不能拖就只能靠滚动条。
    const w = mountViewer()
    const stage = w.find('.cursor-grab')
    expect(stage.exists()).toBe(true)
    const el = prepare(stage)

    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, clientY: 100 }))
    el.dispatchEvent(pointerEvent('pointermove', { clientX: 140, clientY: 120 }))
    await w.vm.$nextTick()

    // 拖动后光标切到"握拳"，并带上位移。
    expect(w.find('.cursor-grabbing').exists()).toBe(true)
    expect(w.html()).toContain('translate(40px, 20px)')
  })

  it('ignores non-primary buttons', async () => {
    const w = mountViewer()
    const el = prepare(w.find('.cursor-grab'))
    el.dispatchEvent(pointerEvent('pointerdown', { button: 2, clientX: 10, clientY: 10 }))
    el.dispatchEvent(pointerEvent('pointermove', { clientX: 90, clientY: 90 }))
    await w.vm.$nextTick()
    // 右键拖动不该移动图片。
    expect(w.html()).toContain('translate(0px, 0px)')
  })

  it('returns to center when the shown image changes', async () => {
    // 残留的偏移会让人以为图片跑丢了。
    const w = mountViewer()
    const el = prepare(w.find('.cursor-grab'))
    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0 }))
    el.dispatchEvent(pointerEvent('pointermove', { clientX: 50, clientY: 50 }))
    await w.vm.$nextTick()
    expect(w.html()).toContain('translate(50px, 50px)')

    await w.setProps({ viewer: {
      imageUrl: '', storagePath: 'supabase://other.png', title: 'other', caption: 'other', zoom: 1,
    } })
    expect(w.html()).toContain('translate(0px, 0px)')
  })
})
