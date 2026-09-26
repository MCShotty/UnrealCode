// Match key material, including JSON-escaped PEM, rather than a parser's header literal.
// Never log matched values. Exact known local credentials are checked separately.
export const secretPatterns = [
  ['provider-key', /\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['private-key', /-----BEGIN (?:RSA |OPENSSH |EC |DSA |ENCRYPTED )?PRIVATE KEY-----(?:\s|\\r|\\n)*[A-Za-z0-9+/=]{32,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{30,}\.eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}/],
  ['credential-json', /"(?:access_token|refresh_token|id_token|api_key|apiKey)"\s*:\s*"[^"\r\n]{24,}"/i],
]
