import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  extractNoteAudioReferences,
  findNoteRanges,
  mergeNoteAudioFile,
  replaceNoteAudioLines,
} from '../scripts/merge-note-audio.mjs'

const SOURCE = [
  '* First [2026-08-03 Mon 10:00:00 -0700]',
  'Text.',
  'Audio recording: [one.webm](recordings/one.webm)',
  'Audio recording: recordings/two.m4a',
  '',
  '* Second [2026-08-03 Mon 11:00:00 -0700]',
  'Audio recording: [other.wav](recordings/other.wav)',
].join('\n')

describe('merge-note-audio script', () => {
  it('finds audio references inside each note', () => {
    const notes = findNoteRanges(SOURCE)
    expect(notes).toHaveLength(2)
    expect(extractNoteAudioReferences(SOURCE, notes[0])).toEqual([
      { reference: 'recordings/one.webm', lineIndex: 2 },
      { reference: 'recordings/two.m4a', lineIndex: 3 },
    ])
  })

  it('rewrites multiple references as one canonical recording', () => {
    const [first] = findNoteRanges(SOURCE)
    const updated = replaceNoteAudioLines(SOURCE, first, 'recordings/one.wav')
    expect(updated.match(/Audio recording:/g)).toHaveLength(2)
    expect(updated).toContain('Audio recording: [one.wav](recordings/one.wav)')
    expect(updated).not.toContain('two.m4a')
    expect(updated).toContain('other.wav')
  })

  it.skipIf(spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0)(
    'merges files, updates the note, and backs up removed parts',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'branch-continue-audio-merge-'))
      try {
        await mkdir(join(root, 'recordings'))
        await writeFile(join(root, 'recordings', 'one.wav'), wavWithSamples([100, 200, 300]))
        await writeFile(join(root, 'recordings', 'two.wav'), wavWithSamples([400, 500]))
        const sourcePath = join(root, 'notes.org')
        await writeFile(sourcePath, [
          '* Note [2026-08-03 Mon 10:00:00 -0700]',
          'Audio recording: [one.wav](recordings/one.wav)',
          'Audio recording: [two.wav](recordings/two.wav)',
        ].join('\n'))

        const result = await mergeNoteAudioFile(sourcePath, { now: new Date('2026-08-03T10:00:00Z') })
        const source = await readFile(sourcePath, 'utf8')
        const merged = await readFile(join(root, 'recordings', 'one.wav'))

        expect(result.changedNotes).toBe(1)
        expect(source.match(/Audio recording:/g)).toHaveLength(1)
        expect(source).toContain('recordings/one.wav')
        expect(merged.length).toBeGreaterThan(44)
        expect(await readFile(join(result.backupRoot!, 'recordings', 'two.wav'))).toBeTruthy()
        await expect(readFile(join(root, 'recordings', 'two.wav'))).rejects.toThrow()
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )
})

function wavWithSamples(samples: number[]): Buffer {
  const buffer = Buffer.alloc(44 + samples.length * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + samples.length * 2, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(16_000, 24)
  buffer.writeUInt32LE(32_000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples.length * 2, 40)
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, 44 + index * 2))
  return buffer
}
