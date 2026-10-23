import { useCallback, useEffect, useState } from 'react'
import { getCodexAccount, startCodexSignIn, type CodexAccountState, type CodexSignIn } from '../agent-runtime/agent-service-runtime'

export function CodexAccount() {
  const [account, setAccount] = useState<CodexAccountState | null>(null)
  const [login, setLogin] = useState<CodexSignIn | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      setAccount(await getCodexAccount())
      setError('')
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }, [])
  useEffect(() => {
    void refresh()
    const focused = () => { void refresh() }
    window.addEventListener('focus', focused)
    return () => window.removeEventListener('focus', focused)
  }, [refresh])
  const signIn = async () => {
    setBusy(true)
    setError('')
    try { setLogin(await startCodexSignIn()) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <div className="note-codex-account">
    <span>{account?.account ? `Codex: ${account.account.email || account.account.type}` : 'Codex account'}</span>
    {!account?.account && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void signIn()}>Sign in with ChatGPT</button>}
    <button type="button" className="btn-secondary" disabled={busy} onClick={() => void refresh()}>{busy ? 'Checking…' : 'Refresh account'}</button>
    {login && !account?.account && <p>
      {(login.authUrl || login.verificationUrl) && <a href={login.authUrl || login.verificationUrl} target="_blank" rel="noreferrer">Continue sign-in</a>}
      {login.userCode && <> Code: <code>{login.userCode}</code></>}
      {' '}After signing in, refresh your account.
    </p>}
    {error && <p className="status-error">{error}</p>}
  </div>
}
