import type { AdminProviderModel, AdminProviderSetting } from '../types/admin'

// Image providers historically stored a single image_model; fall back to it so
// editing an un-migrated row does not silently lose its configured model.
export function providerLegacyModelIds(provider: AdminProviderSetting): string[] {
  if (provider.kind === 'image') return provider.imageModel ? [provider.imageModel] : []
  const models = (provider.models || []).filter(model => Boolean(model && model.trim()))
  if (models.length) return models
  return provider.defaultModel ? [provider.defaultModel] : []
}

export function providerModelCatalogRows(provider: AdminProviderSetting): AdminProviderModel[] {
  if (provider.modelCatalog?.length) return provider.modelCatalog
  if (provider.models?.length) return provider.models.map(id => ({ id, name: id, enabled: true, editModel: null, supportsTransparent: false }))
  return providerLegacyModelIds(provider).map(model => ({ id: model, name: model, enabled: true, editModel: null, supportsTransparent: false }))
}
