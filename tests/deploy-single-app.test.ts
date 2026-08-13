import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('single-app local deploy', () => {
  it('quits the running app before replacement and verifies the new launch', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'branch-continue-deploy-'))
    temporaryDirectories.push(root)
    const sourceApp = path.join(root, 'source', 'Branch Continue.app')
    const userApplications = path.join(root, 'user-apps')
    const userApp = path.join(userApplications, 'Branch Continue.app')
    const systemApp = path.join(root, 'system', 'Branch Continue.app')
    const stateFile = path.join(root, 'running')
    const logFile = path.join(root, 'commands.log')
    const fakeOsascript = path.join(root, 'osascript')
    const fakeOpen = path.join(root, 'open')

    mkdirSync(sourceApp, { recursive: true })
    mkdirSync(userApp, { recursive: true })
    mkdirSync(systemApp, { recursive: true })
    writeFileSync(path.join(sourceApp, 'build.txt'), 'new build')
    writeFileSync(path.join(userApp, 'build.txt'), 'old build')
    writeFileSync(stateFile, 'running')
    writeFileSync(fakeOsascript, `#!/bin/sh
if printf '%s' "$*" | grep -q 'is running'; then
  test -f "$DEPLOY_STATE_FILE" && printf 'true\\n' || printf 'false\\n'
else
  printf 'quit\\n' >> "$DEPLOY_LOG_FILE"
  rm -f "$DEPLOY_STATE_FILE"
fi
`)
    writeFileSync(fakeOpen, `#!/bin/sh
printf 'open:%s\\n' "$1" >> "$DEPLOY_LOG_FILE"
touch "$DEPLOY_STATE_FILE"
`)
    chmodSync(fakeOsascript, 0o755)
    chmodSync(fakeOpen, 0o755)

    execFileSync('bash', ['scripts/deploy-single-app.sh'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        BRANCH_CONTINUE_SOURCE_APP: sourceApp,
        BRANCH_CONTINUE_USER_APPS_DIR: userApplications,
        BRANCH_CONTINUE_SYSTEM_APP: systemApp,
        BRANCH_CONTINUE_OSASCRIPT_COMMAND: fakeOsascript,
        BRANCH_CONTINUE_OPEN_COMMAND: fakeOpen,
        BRANCH_CONTINUE_APP_STATE_TIMEOUT_SECONDS: '2',
        BRANCH_CONTINUE_APP_STABILITY_SECONDS: '0',
        DEPLOY_STATE_FILE: stateFile,
        DEPLOY_LOG_FILE: logFile,
      },
      stdio: 'pipe',
    })

    expect(readFileSync(path.join(userApp, 'build.txt'), 'utf8')).toBe('new build')
    expect(readFileSync(logFile, 'utf8')).toBe(`quit\nopen:${userApp}\n`)
    expect(existsSync(systemApp)).toBe(false)
  })
})
