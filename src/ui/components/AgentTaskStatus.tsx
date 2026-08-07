import type { AgentTaskProgress } from '../lib/agent-links'

export function AgentTaskStatus({
  progress,
  live = true,
}: {
  progress: AgentTaskProgress | null
  live?: boolean
}) {
  if (!progress) return null
  const task = progress.task

  return (
    <section
      className={`agent-task-status agent-task-status--${progress.phase}`}
      {...(live ? { role: 'status', 'aria-live': 'polite' as const } : {})}
    >
      <div className="agent-task-status-head">
        <strong>{statusLabel(progress.phase)}</strong>
        {task?.sourceKind === 'recognized-voice-note' && <span>Voice transcript</span>}
      </div>
      <p>{progress.message}</p>
      {task && (
        <details>
          <summary>Task details</summary>
          <dl>
            <div><dt>Task</dt><dd>{task.taskId}</dd></div>
            <div><dt>Agent</dt><dd>@{task.agent}</dd></div>
            {task.runtimeId && <div><dt>Runtime</dt><dd>{task.runtimeId}</dd></div>}
            {task.recognizedTranscriptChars && (
              <div><dt>Transcript</dt><dd>{task.recognizedTranscriptChars.toLocaleString()} characters</dd></div>
            )}
          </dl>
          {task.launch?.runUrl && (
            <a href={task.launch.runUrl} target="_blank" rel="noreferrer">Open run</a>
          )}
          {task.response && (
            <div className="agent-task-result">
              <strong>Result</strong>
              <pre>{task.response}</pre>
            </div>
          )}
        </details>
      )}
    </section>
  )
}

function statusLabel(phase: AgentTaskProgress['phase']): string {
  if (phase === 'preparing') return 'Preparing'
  if (phase === 'running') return 'Running'
  if (phase === 'completed') return 'Completed'
  if (phase === 'launched') return 'Launched'
  if (phase === 'blocked') return 'Needs attention'
  return 'Failed'
}
