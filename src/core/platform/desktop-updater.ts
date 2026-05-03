let started = false

export function startDesktopUpdater(): void {
  if (started || !import.meta.env.PROD || isLikelyMobileRuntime()) return
  started = true

  window.setTimeout(() => {
    void checkInstallAndRelaunch()
  }, 1500)
}

async function checkInstallAndRelaunch(): Promise<void> {
  try {
    const [{ isTauri }, { check }, { relaunch }] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/plugin-updater'),
      import('@tauri-apps/plugin-process'),
    ])

    if (!isTauri()) return

    const update = await check({ timeout: 15_000 })
    if (!update) return

    console.info(`desktop-updater: installing ${update.version}`)
    await update.downloadAndInstall()
    await relaunch()
  } catch (error) {
    console.warn('desktop-updater: update check failed', error)
  }
}

function isLikelyMobileRuntime(): boolean {
  return /android|iphone|ipad|ipod|mobile/i.test(window.navigator.userAgent)
}
