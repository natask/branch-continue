// Editor — full-screen void for writing

import { useCallback, useRef, useEffect } from 'react'

interface EditorProps {
  title: string
  content: string
  onTitleChange: (title: string) => void
  onContentChange: (content: string) => void
  onBranch: () => void
}

export function Editor({ title, content, onTitleChange, onContentChange, onBranch }: EditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-focus textarea on mount
  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [])

  const handleTitleBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      const val = e.target.value.trim()
      if (val && val !== title) {
        onTitleChange(val)
      }
    },
    [title, onTitleChange],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.shiftKey && e.key === 'Enter') {
        e.preventDefault()
        onBranch()
      }
    },
    [onBranch],
  )

  return (
    <main className="editor">
      <input
        className="editor-title"
        defaultValue={title}
        key={title}
        onBlur={handleTitleBlur}
        placeholder="Untitled"
      />
      <textarea
        ref={textareaRef}
        className="editor-content"
        value={content}
        onChange={(e) => onContentChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Start writing..."
      />
    </main>
  )
}
