// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { CanvasNode } from '../src/lib/image-canvas-model'
import type { ImageCanvasContext } from '../src/types/image'
import { useImageCanvasGeneration } from '../src/composables/useImageCanvasGeneration'
import ImagioView from '../src/components/ImagioView.vue'
import ImageCanvasNode from '../src/components/ImageCanvasNode.vue'
import ImageCanvasGalleryStage from '../src/components/ImageCanvasGalleryStage.vue'
import { isCustomImageAspectRatio, parseImageAspectRatio } from '../src/lib/image-aspect-ratio'

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
  it('normalizes and validates custom image aspect ratios', () => {
    expect(parseImageAspectRatio('8:10')?.value).toBe('4:5')
    expect(parseImageAspectRatio('3:1')?.value).toBe('3:1')
    expect(parseImageAspectRatio('4:1')).toBeNull()
    expect(parseImageAspectRatio('0:1')).toBeNull()
    expect(parseImageAspectRatio('1001:1000')).toBeNull()
    expect(isCustomImageAspectRatio('4:5')).toBe(true)
    expect(isCustomImageAspectRatio('3:2')).toBe(false)
    expect(isCustomImageAspectRatio('invalid')).toBe(false)
  })

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

  it('selects image models from the Codex-style grouped dropdown', async () => {
    const wrapper = mount(ImagioView, {
      props: {
        ...imagioGenerationProps(),
        imageModel: 'gpt-image-2',
        defaultImageModel: 'gpt-image-2',
        modelOptions: [
          { value: 'gpt-image-2', label: 'GPT Image 2' },
          { value: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare' },
        ],
      },
    })

    const modelGroup = wrapper.findAll('.param-group')
      .find(group => group.find('label').text() === '模型')
    const trigger = modelGroup?.find('.image-model-trigger')
    expect(trigger).toBeDefined()
    expect(trigger!.text()).toContain('GPT Image 2')

    await trigger!.trigger('click')
    expect(wrapper.find('.image-model-menu').text()).toContain('默认')
    expect(wrapper.find('.image-model-menu').text()).toContain('推荐模型集')

    const flare = wrapper.findAll('.image-model-option')
      .find(option => option.text() === 'GPT Image 2.5 Flare')
    expect(flare).toBeDefined()
    await flare!.trigger('click')
    expect(wrapper.emitted('update:image-model')).toEqual([['gpt-image-2.5-flare']])
  })

  it('applies a custom Imagio aspect ratio', async () => {
    const wrapper = mount(ImagioView, {
      props: {
        ...imagioGenerationProps(),
        resolution: '1k',
        aspectRatio: 'auto',
        resolutionOptions,
        aspectRatioOptions,
      },
    })

    const ratioGroup = wrapper.findAll('.param-group')
      .find(group => group.find('label').text() === '尺寸 / 比例')
    const customButton = ratioGroup?.findAll('button').find(button => button.text() === '自定义')
    expect(customButton).toBeDefined()
    await customButton!.trigger('click')
    expect(customButton!.classes()).toContain('active')

    const editor = ratioGroup?.find('.custom-ratio-editor')
    expect(editor).toBeDefined()
    const inputs = editor!.findAll('input')
    await inputs[0].setValue('4')
    await inputs[1].setValue('5')
    await editor!.find('button').trigger('click')

    expect(wrapper.emitted('update:aspect-ratio')).toEqual([['4:5']])
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
        modelOptions: [],
        defaultModel: '',
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
        modelOptions: [],
        defaultModel: '',
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

  it('applies a custom canvas-node aspect ratio', async () => {
    const node = generationNode('1k', 'auto')
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
        modelOptions: [],
        defaultModel: '',
        isGenerating: false,
        resolveMentionToken: () => null,
      },
      global: {
        stubs: { AuthenticatedImage: true },
      },
    })

    const ratioGroup = wrapper.findAll('.control-group')
      .find(group => group.find('.control-label').text() === '尺寸 / 比例')
    const customButton = ratioGroup!.findAll('button').find(button => button.text() === '自定义')!
    await customButton.trigger('click')
    expect(customButton.classes()).toContain('active')
    const editor = ratioGroup!.find('.custom-ratio-editor')
    const inputs = editor.findAll('input')
    await inputs[0].setValue('4')
    await inputs[1].setValue('5')
    await editor.find('button').trigger('click')

    expect(wrapper.emitted('update-aspect-ratio')).toEqual([[node, '4:5']])
  })
})

describe('canvas generation node model and transparency controls', () => {
  const modelOptions = [
    { value: 'gpt-image-2.5-sunburst', label: 'Sunburst', supportsTransparent: true },
    { value: 'gpt-image-2.5-flare', label: 'Flare', supportsTransparent: false },
  ]

  function mountGenerationNode(node: CanvasNode, defaultModel = 'gpt-image-2.5-flare') {
    return mount(ImageCanvasNode, {
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
        modelOptions,
        defaultModel,
        isGenerating: false,
        resolveMentionToken: () => null,
      },
      global: {
        stubs: { AuthenticatedImage: true },
      },
    })
  }

  function controlGroup(wrapper: ReturnType<typeof mountGenerationNode>, label: string) {
    const group = wrapper.findAll('.control-group')
      .find(item => item.find('.control-label').text() === label)
    if (!group) throw new Error(`missing control group: ${label}`)
    return group
  }

  it('shows the canvas model until the node picks its own', async () => {
    const node = generationNode('auto', 'auto')
    const wrapper = mountGenerationNode(node)

    // 节点没选模型时跟随画布面板，避免用户以为用的还是默认模型。
    expect(controlGroup(wrapper, '模型').find('.linked-count').text()).toBe('Flare')

    const sunburst = controlGroup(wrapper, '模型').findAll('button')
      .find(button => button.text() === 'Sunburst')!
    await sunburst.trigger('click')

    expect(wrapper.emitted('update-model')).toEqual([[node, 'gpt-image-2.5-sunburst']])
  })

  it('greys out transparent background for models without the capability', () => {
    const node: CanvasNode = { ...generationNode('auto', 'auto'), model: 'gpt-image-2.5-flare', transparentBackground: true }
    const wrapper = mountGenerationNode(node)

    const buttons = controlGroup(wrapper, '背景').findAll('button')
    const transparent = buttons.find(button => button.text() === '透明')!
    expect(transparent.attributes('disabled')).toBeDefined()
    // 残留的透明标记不算已选：按钮回到「不透明」，与实际出图保持一致。
    expect(transparent.classes()).not.toContain('active')
    expect(buttons.find(button => button.text() === '不透明')!.classes()).toContain('active')
    expect(controlGroup(wrapper, '背景').text()).toContain('当前模型不支持透明背景')
  })

  it('emits the transparent background toggle for capable models', async () => {
    const node: CanvasNode = { ...generationNode('auto', 'auto'), model: 'gpt-image-2.5-sunburst', transparentBackground: true }
    const wrapper = mountGenerationNode(node)

    const buttons = controlGroup(wrapper, '背景').findAll('button')
    const transparent = buttons.find(button => button.text() === '透明')!
    expect(transparent.attributes('disabled')).toBeUndefined()
    expect(transparent.classes()).toContain('active')

    const opaque = buttons.find(button => button.text() === '不透明')!
    await opaque.trigger('click')

    expect(wrapper.emitted('update-transparent-background')).toEqual([[node, false]])
  })
})

describe('canvas generation node request parameters', () => {
  function generationHarness(overrides: Partial<CanvasNode> = {}) {
    const node: CanvasNode = { ...generationNode('auto', 'auto'), ...overrides }
    const generate = vi.fn().mockResolvedValue([])
    const canvas = useImageCanvasGeneration({
      nodes: ref<CanvasNode[]>([node]),
      connections: ref([]),
      isGenerating: ref(false),
      error: ref<string | null>(null),
      canSelectGenerationCount: () => true,
      canvasContextEnabled: () => false,
      createNode: (type, x, y, data) => ({ ...generationNode('auto', 'auto'), ...data, id: 'output-1', type, x, y }),
      createConnectionId: () => 'conn-1',
      getRenderedNodeSize: () => ({ width: 232, height: 326 }),
      buildReferences: async () => [],
      buildPromptParts: () => ({ userPrompt: '画一只猫', systemPrompt: '', modelPrompt: '画一只猫' }),
      buildCanvasContext: () => ({} as ImageCanvasContext),
      defaultModel: () => 'gpt-image-2.5-flare',
      modelSupportsTransparent: (modelId: string) => modelId === 'gpt-image-2.5-sunburst',
      generate,
    })
    return { node, generate, canvas }
  }

  it('sends the node model together with the transparency request', async () => {
    const { node, generate, canvas } = generationHarness({
      model: 'gpt-image-2.5-sunburst',
      transparentBackground: true,
    })

    await canvas.generateFromNode(node)

    expect(generate).toHaveBeenCalledWith('画一只猫', expect.objectContaining({
      model: 'gpt-image-2.5-sunburst',
      transparentBackground: true,
    }))
  })

  it('drops the transparency request when the node model does not declare support', async () => {
    const { node, generate, canvas } = generationHarness({
      model: 'gpt-image-2.5-flare',
      transparentBackground: true,
    })

    await canvas.generateFromNode(node)

    const options = generate.mock.calls[0][1] as Record<string, unknown>
    expect(options.model).toBe('gpt-image-2.5-flare')
    // 模型不支持时后端会忽略该参数，照发只会让人以为拿到了透明图。
    expect(options).not.toHaveProperty('transparentBackground')
  })

  it('falls back to the canvas panel model when the node has none', async () => {
    const { node, generate, canvas } = generationHarness({ transparentBackground: true })

    await canvas.generateFromNode(node)

    const options = generate.mock.calls[0][1] as Record<string, unknown>
    expect(options.model).toBe('gpt-image-2.5-flare')
    expect(options).not.toHaveProperty('transparentBackground')
  })
})

describe('image gallery failure recovery', () => {
  it('offers a retry action when the gallery request fails', async () => {
    const wrapper = mount(ImageCanvasGalleryStage, {
      props: {
        images: [],
        filteredCount: 0,
        sourceCount: 0,
        query: '',
        filter: 'latest',
        filterOptions: [{ value: 'latest', label: '最新' }],
        hasFilter: true,
        isPublicFilter: true,
        galleryLoaded: false,
        isLoading: false,
        isLoadingMore: false,
        error: '作品广场加载失败，请稍后重试。',
        resolutionOptions: [],
        qualityOptions: [],
        isImageDownloading: () => false,
      },
    })

    expect(wrapper.text()).toContain('作品广场加载失败，请稍后重试。')
    await wrapper.get('[data-gallery-retry]').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('hides a stale public-gallery error after switching to a private filter', () => {
    const wrapper = mount(ImageCanvasGalleryStage, {
      props: {
        images: [],
        filteredCount: 0,
        sourceCount: 0,
        query: '',
        filter: 'mine',
        filterOptions: [{ value: 'mine', label: '我的' }],
        hasFilter: false,
        isPublicFilter: false,
        galleryLoaded: true,
        isLoading: false,
        isLoadingMore: false,
        error: '作品广场加载失败，请稍后重试。',
        resolutionOptions: [],
        qualityOptions: [],
        isImageDownloading: () => false,
      },
    })

    expect(wrapper.text()).not.toContain('作品广场加载失败，请稍后重试。')
    expect(wrapper.find('[data-gallery-retry]').exists()).toBe(false)
  })
})
