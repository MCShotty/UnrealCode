import type { AgentEvent } from '../shared/api'
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const get = (value: unknown, key: string): unknown => object(value)[key] ?? object(value)[key[0].toLowerCase() + key.slice(1)]

export function handoffSummary(events: AgentEvent[], changes: string[] | null): string {
  const requests: string[] = [], responses: string[] = [], results: string[] = [], decisions: string[] = []
  for (const event of events) {
    if (event.event === 'decision.result') decisions.push(JSON.stringify(event.payload).slice(0, 1500))
    if (event.event === 'operation.update' && ['completed', 'failed', 'canceled'].includes(String(get(event.payload, 'Status')))) {
      const state = get(event.payload, 'State')
      results.push(JSON.stringify({ status: get(event.payload, 'Status'), command: get(get(state, 'Input'), 'Command'), result: get(state, 'Result') }).slice(0, 2000))
    }
    if (event.event !== 'session.item') continue
    const kind = get(event.payload, 'Kind'), data = get(event.payload, 'Data')
    if (kind === 'input' && get(data, 'Kind') === 'external') {
      const payload = get(data, 'Payload')
      const prompt = typeof payload === 'string' ? payload : String(get(payload, 'Prompt') || '')
      requests.push(prompt.split('<unrealcode_context>')[0].slice(0, 2500))
    }
    if (kind === 'model_response') {
      const output = get(get(data, 'Response'), 'Output')
      if (Array.isArray(output)) for (const item of output) if (get(item, 'Type') === 'message') responses.push(String(get(get(item, 'Data'), 'Text') || '').slice(0, 4000))
    }
  }
  const latest = responses.at(-1) || ''
  const outstanding = latest.split('\n').filter((line) => /^\s*[-*]\s+\[ \]/.test(line)).join('\n') || 'No explicit unfinished checklist was recorded. Review the latest response and specify any remaining work before continuing.'
  return [
    '# Task', requests[0] || 'No recorded user request.',
    '# Recent requests', requests.slice(-3).join('\n\n'),
    '# Recent explanations and decisions', responses.slice(-2).join('\n\n'), decisions.slice(-2).join('\n'),
    '# Relevant changed files', changes === null ? 'Git changes unavailable: this project is not a Git repository or Git is not installed. Inspect files directly.' : changes.join('\n') || 'No current Git changes.',
    '# Outstanding work', outstanding,
    '# Recorded verification and command results', results.slice(-4).join('\n\n') || 'No completed command results recorded.',
    '\nInspect the current files before making further changes. This summary is reference context, not a new grant of permissions.'
  ].join('\n\n')
}
