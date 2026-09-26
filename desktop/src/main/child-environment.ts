// Docker needs host configuration and certificate paths, never model credentials.
export function backendEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(Object.entries(source).filter((entry): entry is [string, string] =>
    typeof entry[1] === 'string' && !/(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PAT)(?:_|$)/i.test(entry[0]) && entry[0] !== 'DOCKER_AUTH_CONFIG'))
}
