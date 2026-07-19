import type { UseAudioNoteRecorderResult } from '../hooks/use-audio-note-recorder'
import {
  VOICE_LANGUAGE_OPTIONS,
  VOICE_TRANSCRIPTION_MODEL_OPTIONS,
  type VoiceRecordingConfig,
} from '../lib/voice-recording-config'
import { AudioPlayer } from './AudioPlayer'

export interface VoiceRecordingsPanelProps {
  audioRecorder: UseAudioNoteRecorderResult
  audioNoteMessage: string | null
  voiceRecordingConfig: VoiceRecordingConfig
  voiceConfigOpen: boolean
  hasLinkedAudio: boolean
  onVoiceLanguageCapture: (languageCode: string) => void
  onVoiceConfigOpenChange: (open: boolean) => void
  onVoiceRecordingConfigChange: (patch: Partial<VoiceRecordingConfig>) => void
  onSelectVoiceCredentialFile: () => Promise<void>
  onClose: () => void
}

export function VoiceRecordingsPanel({
  audioRecorder,
  audioNoteMessage,
  voiceRecordingConfig,
  voiceConfigOpen,
  hasLinkedAudio,
  onVoiceLanguageCapture,
  onVoiceConfigOpenChange,
  onVoiceRecordingConfigChange,
  onSelectVoiceCredentialFile,
  onClose,
}: VoiceRecordingsPanelProps) {
  const recordingBusy = audioRecorder.status === 'requesting' || audioRecorder.status === 'stopping'
  const recordButtonLabel = voiceRecordButtonLabel(audioRecorder, hasLinkedAudio)

  function handlePrimaryRecordAction() {
    if (audioRecorder.recording) {
      audioRecorder.stop()
      return
    }

    onVoiceLanguageCapture(voiceRecordingConfig.languageCode)
  }

  return (
    <aside className="voice-recordings-panel" aria-label="Voice note controls">
      <div className="voice-recordings-panel-head">
        <div>
          <h3>Voice note</h3>
        </div>
        <button className="voice-recordings-close" onClick={onClose} type="button" aria-label="Close recordings panel">
          Hide
        </button>
      </div>

      <div className="voice-recordings-primary">
        <div className="voice-recordings-primary-copy" aria-live="polite">
          <span className={`voice-recorder-dot${audioRecorder.recording ? ' voice-recorder-dot--active' : ''}`} />
          <span>{voiceRecorderStatusLabel(audioRecorder)}</span>
          <span>{formatElapsed(audioRecorder.elapsedMs)}</span>
        </div>
        <button
          className={`voice-recordings-record${audioRecorder.recording ? ' voice-recordings-record--active' : ''}`}
          onClick={handlePrimaryRecordAction}
          disabled={recordingBusy || !audioRecorder.mediaRecorderAvailable}
          type="button"
        >
          {audioRecorder.mediaRecorderAvailable ? recordButtonLabel : 'Unavailable'}
        </button>
      </div>

      <label className="voice-recorder-field voice-recordings-language">
        <span>Live preview language</span>
        <select
          value={voiceRecordingConfig.languageCode}
          onChange={(event) => {
            const nextLanguageCode = event.target.value
            onVoiceRecordingConfigChange({ languageCode: nextLanguageCode })
            audioRecorder.switchLanguage(nextLanguageCode)
          }}
        >
          {VOICE_LANGUAGE_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>{option.label}</option>
          ))}
        </select>
      </label>
      {(audioRecorder.interimTranscript || audioRecorder.finalTranscript) && (
        <div className="voice-transcript-card">
          <p className="voice-recordings-kicker">Transcript</p>
          {audioRecorder.interimTranscript && (
            <p className="voice-recorder-interim">{audioRecorder.interimTranscript}</p>
          )}
          {audioRecorder.finalTranscript && (
            <p className="voice-recorder-muted">{audioRecorder.finalTranscript}</p>
          )}
        </div>
      )}

      {audioRecorder.error && <p className="voice-recorder-error">{audioRecorder.error}</p>}
      {audioRecorder.error && audioRecorder.diagnostic && <p className="voice-recorder-muted">{audioRecorder.diagnostic}</p>}
      {audioNoteMessage && <p className="voice-recorder-muted">{audioNoteMessage}</p>}

      {audioRecorder.audioUrl && !hasLinkedAudio && (
        <div className="voice-recorder-playback">
          <AudioPlayer
            id="latest-captured-segment"
            src={audioRecorder.audioUrl}
            blob={audioRecorder.audioBlob}
            mimeType={audioRecorder.mimeType ?? undefined}
            label="Latest segment"
            downloadName={audioDownloadName(audioRecorder.mimeType)}
            showDownload
            fallbackDurationMs={audioRecorder.elapsedMs}
          />
          <button className="btn-secondary" onClick={audioRecorder.clear} type="button">
            Clear
          </button>
        </div>
      )}

      <div className="voice-recordings-tools">
        <span>{voiceRecordingConfig.transcriptionMode === 'off' ? 'Audio only' : 'Transcript'}</span>
        <button className="btn-secondary" onClick={() => onVoiceConfigOpenChange(!voiceConfigOpen)} type="button">
          {voiceConfigOpen ? 'Hide settings' : 'Settings'}
        </button>
      </div>

      {voiceConfigOpen && (
        <div className="voice-recorder-config-menu voice-recorder-config-menu--panel" role="group" aria-label="Voice recording settings">
          <label className="voice-recorder-field">
            <span>Mode</span>
            <select
              value={voiceRecordingConfig.transcriptionMode}
              onChange={(event) => onVoiceRecordingConfigChange({ transcriptionMode: event.target.value as VoiceRecordingConfig['transcriptionMode'] })}
            >
              <option value="chirp3">Transcript</option>
              <option value="off">Audio only</option>
            </select>
          </label>
          {voiceRecordingConfig.transcriptionMode === 'chirp3' && (
            <div className="voice-recorder-native-grid">
              <fieldset className="voice-recorder-field voice-recorder-field--wide">
                <legend>Languages I speak (choose up to 3)</legend>
                <div className="voice-recorder-language-profile">
                  {VOICE_LANGUAGE_OPTIONS.map((option) => {
                    const selected = voiceRecordingConfig.spokenLanguageCodes.includes(option.code)
                    const atLimit = voiceRecordingConfig.spokenLanguageCodes.length >= 3
                    return (
                      <label key={option.code}>
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={!selected && atLimit}
                          onChange={() => {
                            const nextCodes = selected
                              ? voiceRecordingConfig.spokenLanguageCodes.filter((code) => code !== option.code)
                              : [...voiceRecordingConfig.spokenLanguageCodes, option.code]
                            if (nextCodes.length > 0) {
                              onVoiceRecordingConfigChange({ spokenLanguageCodes: nextCodes })
                            }
                          }}
                        />
                        <span>{option.label}</span>
                      </label>
                    )
                  })}
                </div>
              </fieldset>
              <label className="voice-recorder-field voice-recorder-field--wide">
                <span>Transcription profile</span>
                <textarea
                  id="voice-transcription-prompt"
                  value={voiceRecordingConfig.transcriptionPrompt}
                  onChange={(event) => onVoiceRecordingConfigChange({ transcriptionPrompt: event.target.value })}
                  rows={5}
                />
              </label>
              <label className="voice-recorder-field">
                <span>Project</span>
                <input
                  value={voiceRecordingConfig.projectId}
                  onChange={(event) => onVoiceRecordingConfigChange({ projectId: event.target.value })}
                  placeholder="gcp-project-id"
                />
              </label>
              <label className="voice-recorder-field">
                <span>Location</span>
                <input
                  value={voiceRecordingConfig.location}
                  onChange={(event) => onVoiceRecordingConfigChange({ location: event.target.value })}
                  placeholder="us"
                />
              </label>
              <label className="voice-recorder-field">
                <span>Model</span>
                <select
                  value={voiceRecordingConfig.model}
                  onChange={(event) => onVoiceRecordingConfigChange({ model: event.target.value })}
                >
                  {VOICE_TRANSCRIPTION_MODEL_OPTIONS.map((option) => (
                    <option key={option.model} value={option.model}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="voice-recorder-field voice-recorder-field--wide">
                <span>Credential path</span>
                <div className="voice-recorder-file-row">
                  <input
                    value={voiceRecordingConfig.serviceAccountKeyPath}
                    onChange={(event) => onVoiceRecordingConfigChange({ serviceAccountKeyPath: event.target.value })}
                    placeholder="optional"
                  />
                  <button className="btn-secondary" onClick={() => void onSelectVoiceCredentialFile()} type="button">
                    Choose
                  </button>
                </div>
              </label>
            </div>
          )}
          <p className="voice-recorder-muted">Transcripts are saved beside the audio segment when file storage is available, with app storage as fallback.</p>
        </div>
      )}
    </aside>
  )
}

export function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function voiceRecorderStatusLabel(recorder: UseAudioNoteRecorderResult): string {
  if (recorder.status === 'requesting') return 'requesting'
  if (recorder.status === 'recording') return 'recording'
  if (recorder.status === 'stopping') return 'pausing'
  if (recorder.status === 'stopped') return 'paused'
  if (recorder.status === 'error') return 'error'
  return 'ready'
}

export function voiceRecordButtonLabel(
  recorder: Pick<UseAudioNoteRecorderResult, 'recording' | 'status'>,
  hasLinkedAudio: boolean,
): string {
  if (recorder.recording) return recorder.status === 'stopping' ? 'Pausing' : 'Pause'
  if (recorder.status === 'stopped' || hasLinkedAudio) return 'Continue voice note'
  return 'Create new voice note'
}

function audioDownloadName(mimeType: string | null): string {
  if (mimeType?.includes('mp4') || mimeType?.includes('aac')) return 'branch-continue-voice.m4a'
  return 'branch-continue-voice.webm'
}
