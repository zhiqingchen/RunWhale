export interface ModelProviderDefinition {
  name: string
  agentName?: string
  defaultModel: string
  credentialKey: string
  baseURL: string
  imageGeneration?: boolean
  managed?: boolean
  credentialValue?: string
}
