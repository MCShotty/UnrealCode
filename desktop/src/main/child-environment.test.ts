import { expect, it } from 'vitest'
import { backendEnvironment } from './child-environment'

it('excludes provider and subscription credentials from Docker child environments', () => {
  const result = backendEnvironment({ PATH: 'tools', SystemRoot: 'windows', DOCKER_CONTEXT: 'desktop-linux', NODE_EXTRA_CA_CERTS: 'public-ca.crt',
    OPENAI_API_KEY: 'secret-a', TYPESAFE_API_KEY: 'secret-b', ANTHROPIC_API_KEY: 'secret-c', OPENAI_CODEX_ACCESS_TOKEN: 'secret-d',
    CODEX_API_KEY: 'secret-e', GITHUB_TOKEN: 'secret-f', AWS_SECRET_ACCESS_KEY: 'secret-g', DOCKER_AUTH_CONFIG: 'secret-h' })
  expect(result).toEqual({ PATH: 'tools', SystemRoot: 'windows', DOCKER_CONTEXT: 'desktop-linux', NODE_EXTRA_CA_CERTS: 'public-ca.crt' })
})
