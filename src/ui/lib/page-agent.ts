import { preserveAgentMetadata, stripAgentMetadata } from './agent-links'
import { preserveConceptMetadata, stripConceptMetadata } from '../../core/backbone/concepts'

const PROMPT_LINE = /^<!-- backbone-page-system:v1 (.*?) -->\n?/m

export function pageSystemPrompt(body: string): string {
  const value = body.match(PROMPT_LINE)?.[1]
  if (!value) return ''
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value))
    return typeof parsed === 'string' ? parsed : ''
  } catch { return '' }
}

export function stripPageSystemPrompt(body: string): string {
  return body.replace(PROMPT_LINE, '')
}

export function withPageSystemPrompt(body: string, prompt: string): string {
  const visible = stripPageSystemPrompt(body)
  return prompt.trim()
    ? `<!-- backbone-page-system:v1 ${encodeURIComponent(JSON.stringify(prompt))} -->\n${visible}`
    : visible
}

/** Keep a late agent result from replacing edits made while the request ran. */
export function applyPageAgentEdit(current: string, base: string, edited: string): string | null {
  const prose = (body: string) => stripAgentMetadata(stripConceptMetadata(stripPageSystemPrompt(body)))
  if (prose(current) !== prose(base)) return null
  // Ideas, instructions, and task records can change independently of wording.
  // Keep their latest values rather than rolling them back to launch time.
  return preserveAgentMetadata(preserveConceptMetadata(withPageSystemPrompt(stripPageSystemPrompt(edited), pageSystemPrompt(current)), current), current)
}
