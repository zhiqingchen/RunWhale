import type { ModelProviderDefinition } from './provider-types.js'

export interface AdditionalModelProviders {}
export interface AdditionalHostRequests {}
export const additionalProviders: Record<keyof AdditionalModelProviders, ModelProviderDefinition> = {}
