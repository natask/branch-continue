import { useId } from 'react'
import type { SwitchboardTaskRecord } from '../../core/intents/switchboard-task'

interface SwitchboardTaskStatusProps {
  task: SwitchboardTaskRecord
  refreshing: boolean
  refreshDisabled?: boolean
  onRefresh: () => void
}

export function SwitchboardTaskStatus({
  task,
  refreshing,
  refreshDisabled = false,
  onRefresh,
}: SwitchboardTaskStatusProps) {
  const headingId = useId()
  const projection = task.projection
  const receipt = task.receipt
  const refreshError = task.refreshError
    ?? (task as SwitchboardTaskRecord & { statusError?: string }).statusError

  return (
    <section
      className={`switchboard-task switchboard-task--${projection?.phase ?? 'admitted'}`}
      aria-labelledby={headingId}
      aria-busy={refreshing}
    >
      <header className="switchboard-task-header">
        <div>
          <span className="switchboard-task-eyebrow">Switchboard task</span>
          <h3 id={headingId}>{projection?.phase ?? 'admitted'}</h3>
        </div>
        <button
          className="branch-control switchboard-task-refresh"
          onClick={onRefresh}
          disabled={refreshDisabled || refreshing}
          type="button"
        >
          {refreshing ? 'Refreshing status…' : 'Refresh status'}
        </button>
      </header>

      <dl className="switchboard-task-identity">
        <div>
          <dt>Admission</dt>
          <dd title={receipt.admissionId}>{receipt.admissionId}</dd>
        </div>
        <div>
          <dt>Message</dt>
          <dd title={receipt.messageId}>{receipt.messageId}</dd>
        </div>
        <div>
          <dt>Raw intent</dt>
          <dd title={receipt.rawIntentId}>{receipt.rawIntentId}</dd>
        </div>
        <div>
          <dt>Source hash</dt>
          <dd title={receipt.sourceHash}>{shortHash(receipt.sourceHash)}</dd>
        </div>
        <div>
          <dt>Idempotency</dt>
          <dd title={receipt.idempotencyKey}>{receipt.idempotencyKey}</dd>
        </div>
      </dl>

      <div className="switchboard-routing" aria-label="Switchboard routing status">
        <strong>Routing</strong>
        <dl>
          <div><dt>Admission</dt><dd><code>{receipt.admissionState}</code></dd></div>
          {projection && (
            <>
              <div><dt>Inbox</dt><dd><code>{projection.inboxState}</code></dd></div>
              <div><dt>Raw intent</dt><dd><code>{projection.rawIntentState}</code></dd></div>
              <div><dt>Task</dt><dd><code>{projection.taskState}</code></dd></div>
            </>
          )}
        </dl>
      </div>

      {projection ? (
        <div className="switchboard-projection">
          <div className="switchboard-projection-heading">
            <strong>
              Execution intents ({projection.intents.length}
              {projection.totalIntentCount > projection.intents.length
                ? ` of ${projection.totalIntentCount}`
                : ''})
            </strong>
            <time dateTime={projection.checkedAt} title={projection.checkedAt}>
              Checked {formatCheckedAt(projection.checkedAt)}
            </time>
          </div>
          {projection.intents.length > 0 ? (
            <ol className="switchboard-intent-list" role="list">
              {projection.intents.map((intent) => (
                <li className="switchboard-intent" key={intent.intentId}>
                  <div className="switchboard-intent-heading">
                    <div>
                      {intent.workstreamNumber !== undefined && (
                        <span>Workstream {intent.workstreamNumber}</span>
                      )}
                      <h4>{intent.title}</h4>
                    </div>
                    {intent.relation && <span>{intent.relation}</span>}
                  </div>

                  <dl className="switchboard-intent-states">
                    <div>
                      <dt>Intent state</dt>
                      <dd><code>{intent.intentState ?? 'not reported'}</code></dd>
                    </div>
                    <div>
                      <dt>Execution state</dt>
                      <dd><code>{intent.executionState ?? 'not launched'}</code></dd>
                    </div>
                    {intent.agentName && <div><dt>Agent</dt><dd>{intent.agentName}</dd></div>}
                    {intent.agentStatus && <div><dt>Agent status</dt><dd><code>{intent.agentStatus}</code></dd></div>}
                    {intent.executionId && <div><dt>Execution</dt><dd>{intent.executionId}</dd></div>}
                  </dl>

                  {(intent.summary || intent.nextAction || intent.blockedReason) && (
                    <dl className="switchboard-intent-copy">
                      {intent.summary && <div><dt>Summary</dt><dd>{intent.summary}</dd></div>}
                      {intent.nextAction && <div><dt>Next action</dt><dd>{intent.nextAction}</dd></div>}
                      {intent.blockedReason && <div><dt>Blocker</dt><dd>{intent.blockedReason}</dd></div>}
                    </dl>
                  )}

                  {intent.executionResult && (
                    <div className="switchboard-intent-output switchboard-intent-output--result">
                      <strong>Result</strong>
                      <pre>{intent.executionResult}</pre>
                    </div>
                  )}
                  {intent.executionError && (
                    <div className="switchboard-intent-output switchboard-intent-output--error">
                      <strong>Execution error</strong>
                      <pre>{intent.executionError}</pre>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="switchboard-task-empty">No compiled intent projection is available yet.</p>
          )}
        </div>
      ) : (
        <p className="switchboard-task-empty">
          The handoff is admitted. Refresh status to inspect routing and execution progress.
        </p>
      )}

      {refreshError && (
        <p className="switchboard-task-error">
          <strong>Status error:</strong> {refreshError}
        </p>
      )}
    </section>
  )
}

function shortHash(hash: string): string {
  const [algorithm, digest = algorithm] = hash.split(':', 2)
  const prefix = digest.slice(0, 12)
  const suffix = digest.length > prefix.length ? '…' : ''
  return hash.includes(':') ? `${algorithm}:${prefix}${suffix}` : `${prefix}${suffix}`
}

function formatCheckedAt(value: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}
