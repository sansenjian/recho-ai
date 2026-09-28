import type { AdminProviderModel, AdminProviderSetting } from '../types/admin'

// Image providers historically stored a single image_model; fall back to it so
// editing an un-migrated row does not silently lose its configured model.
export function providerLegacyModelIds(provider: AdminProviderSetting): string[] {
  if (provider.kind === 'image') return provider.imageModel ? [provider.imageModel] : []
  const models = (provider.models || []).filter(model => Boolean(model && model.trim()))
  if (models.length) return models
  return provider.defaultModel ? [provider.defaultModel] : []
}

function modelRow(id: string): AdminProviderModel {
  return { id, name: id, enabled: true, editModel: null, supportsTransparent: false }
}

export function providerModelCatalogRows(provider: AdminProviderSetting): AdminProviderModel[] {
  if (provider.modelCatalog?.length) return provider.modelCatalog
  const legacy = providerLegacyModelIds(provider)
  if (provider.kind === 'image' && provider.imageModel) {
    // Saving an image provider derives image_model from the first *enabled* catalog row,
    // so row order decides the default model. Surface the configured image_model first:
    // otherwise editing an un-migrated row would silently repoint image_model at
    // whichever id happened to be first in the legacy `models` array.
    return [provider.imageModel, ...legacy.filter(id => id !== provider.imageModel)].map(modelRow)
  }
  if (provider.models?.length) return provider.models.map(modelRow)
  return legacy.map(modelRow)
}
