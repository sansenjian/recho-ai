import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasNode } from '../src/lib/image-canvas-model'
import ImagioView from '../src/components/ImagioView.vue'
import ImageCanvasNode from '../src/components/ImageCanvasNode.vue'

const resolutionOptions = [
  { value: 'auto' as const, label: 'Auto' },
  { value: '1k' as const, label: '1K' },
  { value: '2k' as const, label: '2K' },
  { value: '4k' as const, label: '4K' },
]

const aspectRatioOptions = [
  { value: 'auto' as const, label: 'Auto' },
  { value: '1:1' as const, label: '1:1' },
  { value: '16:9' as const, label: '16:9' },
]

function imagioGenerationProps(generate = vi.fn().mockResolvedValue(null)) {
  return {
    generate,
    isGenerating: false,
    error: null,
  }
}

function generationNode(resolution: CanvasNode['resolution'], aspectRatio: CanvasNode['aspectRatio']): CanvasNode {
  return {
    id: 'generation-1',
    type: 'generation',
    x: 0,
    y: 0,
    title: '图片生成',
    content: '',
    size: 'auto',
    resolution,
    aspectRatio,
    quality: 'auto',
    count: 1,
  }
}

describe('image generation Auto resolution controls', () => {
  it('resets Imagio aspect ratio when Auto resolution is selected', async () => {
    const wrapper = mount(ImagioView, {
      props: {
        ...imagioGenerationProps(),
        resolution: '1k',
        aspectRatio: '16:9',
        resolutionOptions,
        aspectRatioOptions,
      },
    })
    const resolutionGroup = wrapper.findAll('.param-group')
      .find(group => group.find('label').text() === '分辨率')
    const autoButton = resolutionGroup?.findAll('button').find(button => button.text() === 'Auto')

    expect(autoButton).toBeDefined()
    await autoButton!.trigger('click')

    expect(wrapper.emitted('update:resolution')).toEqual([['auto']])
    expect(wrapper.emitted('update:aspect-ratio')).toEqual([['auto']])
  })

  it('disables concrete Imagio ratios while resolution is Auto', () => {
    const wrapper = mount(ImagioView, {
      props: {
        ...imagioGenerationProps(),
        resolution: 'auto',
        aspectRatio: 'auto',
        resolutionOptions,
        aspectRatioOptions,
      },
    })
    const ratioGroup = wrapper.findAll('.param-group')
      .find(group => group.find('label').text() === '尺寸 / 比例')
    const ratioButtons = ratioGroup?.findAll('button') ?? []

    expect(ratioButtons.find(button => button.text() === 'Auto')?.attributes('disabled')).toBeUndefined()
    expect(ratioButtons.find(button => button.text() === '1:1')?.attributes('disabled')).toBeDefined()
    expect(ratioButtons.find(button => button.text() === '16:9')?.attributes('disabled')).toBeDefined()
  })

  it('uses the parent generation pipeline in Imagio mode', async () => {
    const generate = vi.fn().mockResolvedValue([])
    const wrapper = mount(ImagioView, {
      props: {
        ...imagioGenerationProps(generate),
        imageModel: 'gpt-image-2',
        resolution: 'auto',
        aspectRatio: 'auto',
        quality: 'medium',
      },
    })

    await wrapper.find('.prompt-input').setValue('生成一张海报')
    await wrapper.find('.generate-btn').trigger('click')

    expect(generate).toHaveBeenCalledWith('生成一张海报', {
      count: 1,
      resolution: 'auto',
      aspectRatio: 'auto',
      quality: 'medium',
      model: 'gpt-image-2',
      references: [],
    })
  })

  it('does not invoke the parent pipeline while generation is already active', async () => {
    const generate = vi.fn().mockResolvedValue([])
    const wrapper = mount(ImagioView, {
      props: {
        ...imagioGenerationProps(generate),
      },
    })

    await wrapper.find('.prompt-input').setValue('生成一张海报')
    await wrapper.setProps({ isGenerating: true })
    await (wrapper.vm as unknown as { handleGenerate: () => Promise<void> }).handleGenerate()

    expect(generate).not.toHaveBeenCalled()
  })

  it('resets canvas-node aspect ratio when Auto resolution is selected', async () => {
    const node = generationNode('1k', '16:9')
    const wrapper = mount(ImageCanvasNode, {
      props: {
        node,
        selected: true,
        nodeStyle: {},
        mentionState: null,
        mentionOptions: [],
        textMentionOpen: false,
        generationMentionOpen: false,
        connectedHandles: {},
        isGeneratedImageNode: false,
        imageAlt: '',
        imageOutputMeta: '',
        isDownloading: false,
        hasPromptLink: false,
        generationPromptValue: '',
        referencedImageNodes: [],
        canSelectGenerationCount: true,
        generationCount: 1,
        generationCountOptions: [{ value: 1, label: '1' }],
        resolutionOptions,
        aspectRatioOptions,
        qualityOptions: [{ value: 'auto', label: 'Auto' }],
        isGenerating: false,
        resolveMentionToken: () => null,
      },
      global: {
        stubs: { AuthenticatedImage: true },
      },
    })
    const resolutionGroup = wrapper.findAll('.control-group')
      .find(group => group.find('.control-label').text() === '分辨率')
    const autoButton = resolutionGroup?.findAll('button').find(button => button.text() === 'Auto')

    expect(autoButton).toBeDefined()
    await autoButton!.trigger('click')

    expect(wrapper.emitted('update-resolution')).toEqual([[node, 'auto']])
    expect(wrapper.emitted('update-aspect-ratio')).toEqual([[node, 'auto']])
  })

  it('disables concrete canvas-node ratios while resolution is Auto', () => {
    const wrapper = mount(ImageCanvasNode, {
      props: {
        node: generationNode('auto', 'auto'),
        selected: true,
        nodeStyle: {},
        mentionState: null,
        mentionOptions: [],
        textMentionOpen: false,
        generationMentionOpen: false,
        connectedHandles: {},
        isGeneratedImageNode: false,
        imageAlt: '',
        imageOutputMeta: '',
        isDownloading: false,
        hasPromptLink: false,
        generationPromptValue: '',
        referencedImageNodes: [],
        canSelectGenerationCount: true,
        generationCount: 1,
        generationCountOptions: [{ value: 1, label: '1' }],
        resolutionOptions,
        aspectRatioOptions,
        qualityOptions: [{ value: 'auto', label: 'Auto' }],
        isGenerating: false,
        resolveMentionToken: () => null,
      },
      global: {
        stubs: { AuthenticatedImage: true },
      },
    })
    const ratioGroup = wrapper.findAll('.control-group')
      .find(group => group.find('.control-label').text() === '尺寸 / 比例')
    const ratioButtons = ratioGroup?.findAll('button') ?? []

    expect(ratioButtons.find(button => button.text() === 'Auto')?.attributes('disabled')).toBeUndefined()
    expect(ratioButtons.find(button => button.text() === '1:1')?.attributes('disabled')).toBeDefined()
    expect(ratioButtons.find(button => button.text() === '16:9')?.attributes('disabled')).toBeDefined()
  })
})
