type CodexAuth = { auth_mode?: string; tokens?: { access_token?: string; account_id?: string } }

export function parseCodexAuth(value: unknown): { accessToken: string; accountId: string } {
  const auth = value as CodexAuth | null
  if (!auth || typeof auth !== 'object') throw new Error('Codex login file is invalid')
  if (auth.auth_mode && auth.auth_mode !== 'chatgpt') throw new Error('Codex is not signed in with a ChatGPT subscription.')
  const accessToken = auth.tokens?.access_token || ''
  const accountId = auth.tokens?.account_id || ''
  if (!accessToken || !accountId) throw new Error('Codex login is incomplete. Sign in with Codex, then reconnect.')
  return { accessToken, accountId }
}
