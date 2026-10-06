import { lstatSync, readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { normalizeSessionResponse } from '../orca-profiles/profile-cloud-client'

export async function importServeRelaySession(env = process.env): Promise<void> {
  const file = env.ORCA_SELFHOST_SESSION_FILE
  if (!file) {
    return
  }
  const origin = env.ORCA_CLOUD_API_URL
  if (!origin || new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin) {
    throw new Error('ORCA_CLOUD_API_URL must be an explicit HTTPS origin for session import')
  }
  if (!isAbsolute(file)) {
    throw new Error('ORCA_SELFHOST_SESSION_FILE must be absolute')
  }
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.size > 1024 * 1024) {
    throw new Error('Invalid relay session file')
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077 || stat.uid !== process.getuid?.())) {
    throw new Error('Relay session file must be owned by the service user with mode 0600')
  }
  let value: unknown
  try {
    value = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new Error('Cannot parse relay session file')
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !('origin' in value) ||
    value.origin !== origin ||
    !('session' in value)
  ) {
    throw new Error('Relay session file origin does not match ORCA_CLOUD_API_URL')
  }
  const session = normalizeSessionResponse(value.session)
  if (
    session.expiresAt <= Date.now() + 60_000 ||
    session.capabilities.flags['relay.use'] !== true
  ) {
    throw new Error(
      'Relay session must be fresh and entitled to relay.use; run selfhost-relay-login.mjs'
    )
  }
  const [
    { ensureActiveOrcaProfile },
    { getProfileUserDataPath },
    { linkOrcaProfileToCloud },
    { saveOrcaCloudSessionExchange }
  ] = await Promise.all([
    import('../orca-profiles/profile-index-store'),
    import('../orca-profiles/profile-storage-paths'),
    import('../orca-profiles/profile-cloud-index'),
    import('../orca-profiles/profile-cloud-session-store')
  ])
  const userData = getProfileUserDataPath()
  const active = ensureActiveOrcaProfile(userData)
  const cloud = active.profile.cloud
  if (
    cloud &&
    (cloud.userId !== session.cloud.userId ||
      cloud.cloudProfileId !== session.cloud.cloudProfileId ||
      cloud.activeOrgId !== session.cloud.activeOrgId)
  ) {
    throw new Error(
      'Refusing to replace a different linked account; use a dedicated headless profile'
    )
  }
  linkOrcaProfileToCloud(active.profile.id, session.cloud, userData)
  saveOrcaCloudSessionExchange(active.profile.id, userData, session)
}
