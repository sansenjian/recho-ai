export interface MCPServerConfig {
  type: 'stdio' | 'sse' | 'streamableHttp'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
}

export interface MCPConnection {
  client: any // @modelcontextprotocol/sdk Client
  transport: any
  tools: MCPTool[]
  status: string
}

export interface MCPTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface MCPToolCallResult {
  content?: Array<{ type: string; text?: string }>
}
