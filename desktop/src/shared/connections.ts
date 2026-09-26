export type ConnectionKind = 'remote' | 'host' | 'container'
export type ConnectionConfig = {
  id: string; name: string; kind: ConnectionKind; url?: string; command?: string; args: string[]
  auth: 'none' | 'bearer' | 'oauth'; timeoutMs: number
}
export type ConnectionGrant = { project: string; connectionId: string; hostTrusted: boolean; tools: string[]; resources: boolean; prompts: boolean; revision: number }
export type CatalogTool = { name: string; remoteName: string; connectionId: string; connectionRevision: string; description: string; inputSchema: Record<string, unknown>; revision: string; enabled: boolean }
export type ConnectionView = ConnectionConfig & { status: 'disconnected' | 'connecting' | 'connected' | 'error'; message: string; hasCredential: boolean; tools: CatalogTool[]; grant?: ConnectionGrant }
export type ConnectionResource = { uri: string; name: string; description?: string }
export type ConnectionPrompt = { name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }
export type HostOperation = { requestId: string; sessionId: string; operationId: string; workspaceId: string; tool: string; arguments: Record<string, unknown> }
export type HostApproval = HostOperation & { id: string; project: string; digest: string; expiresAt: string; target: string }
export type HostResult = { text: string; error?: boolean }
