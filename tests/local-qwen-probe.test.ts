import { describe, expect, it } from 'vitest'

const probe = await import('../scripts/local-qwen-probe.mjs')

describe('local-qwen-probe org packing', () => {
  it('splits dummy org content by any headline line', () => {
    const sections = probe.splitOrgSections([
      'loose preamble',
      '* First',
      'body',
      '** Nested also becomes an independent request section',
      'nested body',
      '* Second',
      'tail',
    ].join('\n'))

    expect(sections.map((section: { title: string }) => section.title)).toEqual([
      'Preamble',
      'First',
      'Nested also becomes an independent request section',
      'Second',
    ])
  })

  it('packs only the first context-budgeted portion', () => {
    const sections = probe.splitOrgSections(probe.makeDummyOrg({ sections: 20, wordsPerSection: 80 }))
    const packed = probe.packOrgSections(sections, {
      contextWindowTokens: 1_000,
      contextFraction: 0.5,
      reservedOutputTokens: 100,
      systemPrompt: 'small',
    })

    expect(packed.sectionsIncluded).toBeGreaterThan(0)
    expect(packed.sectionsIncluded).toBeLessThan(sections.length)
    expect(packed.truncated).toBe(true)
    expect(packed.estimatedInputTokens).toBeLessThanOrEqual(packed.targetTokens)
  })

  it('can omit the system prompt for minimum overhead', () => {
    const request = probe.buildChatRequest({
      model: 'local-model',
      packedText: '* Dummy\ntext',
      systemPrompt: 'none',
    })

    expect(request.messages).toHaveLength(1)
    expect(request.messages[0].role).toBe('user')
  })

  it('builds an opencode command that uses pure mode and file attachment', () => {
    const command = probe.buildOpencodeCommand({
      model: 'other-machine/Qwen3.6-35B-A3B',
      contextPath: 'scratch/local-qwen-probe/run/packed-org-context.md',
      workspaceDir: 'scratch/local-qwen-probe/run',
    })

    expect(command.command).toBe('opencode')
    expect(command.args).toContain('--pure')
    expect(command.args).toContain('--model')
    expect(command.args).toContain('other-machine/Qwen3.6-35B-A3B')
    expect(command.args).toContain('--file')
    expect(command.args).toContain('scratch/local-qwen-probe/run/packed-org-context.md')
    expect(command.args).toContain('--dir')
    expect(command.args).toContain('scratch/local-qwen-probe/run')
  })
})
