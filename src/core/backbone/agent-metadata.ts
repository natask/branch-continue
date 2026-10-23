const AGENT_TASK_BLOCK_PATTERN = /<!-- branch-continue-agent-task:start ([A-Za-z0-9_-]+) -->\n([\s\S]*?)\n<!-- branch-continue-agent-task:end \1 -->/g

interface AgentMetadataRange { start: number; end: number }

/** Only generated, delimited records are hidden; ordinary prose stays editable. */
function agentMetadataRanges(body: string): AgentMetadataRange[] {
  const ranges: AgentMetadataRange[] = []
  const patterns = [
    new RegExp(AGENT_TASK_BLOCK_PATTERN),
    /<!-- branch-continue-agent-turn:start -->\r?\n[\s\S]*?\r?\n<!-- branch-continue-agent-turn:end -->/g,
    /^Agent chat:[ \t]*\r?\nSession:[^\r\n]*\r?\n(?:[ \t]*\r?\n)*(?:(?:Codex session|Runtime session):[^\r\n]*\r?\n(?:[ \t]*\r?\n)*)?(?=<!-- branch-continue-agent-(?:turn|task):start)/gm,
    /^(?:Codex session|Runtime session):[^\r\n]*\r?\n(?:[ \t]*\r?\n)*(?=<!-- branch-continue-agent-(?:turn|task):start)/gm,
  ]
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) ranges.push({ start: match.index!, end: match.index! + match[0].length })
  }
  ranges.sort((left, right) => left.start - right.start)
  const merged: AgentMetadataRange[] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

export function stripAgentMetadata(body: string): string {
  const ranges = agentMetadataRanges(body)
  let visible = ''
  let cursor = 0
  for (const range of ranges) {
    // Remove only the separator introduced when appending the record. This
    // preserves user-entered trailing newlines through subsequent keystrokes.
    const start = range.start - (body.slice(range.start - 2, range.start) === '\n\n' ? 2 : 0)
    visible += body.slice(cursor, Math.max(cursor, start))
    cursor = range.end
  }
  return visible + body.slice(cursor)
}

export function preserveAgentMetadata(visibleBody: string, originalBody: string): string {
  const records = agentMetadataRanges(originalBody).map((range) => originalBody.slice(range.start, range.end))
  const visible = stripAgentMetadata(visibleBody)
  return records.length ? `${visible}\n\n${records.join('\n\n')}` : visible
}
