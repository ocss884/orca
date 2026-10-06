import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importServeRelaySession } from './serve-relay-session'

const store = vi.hoisted(() => ({ active: vi.fn(), link: vi.fn(), save: vi.fn() }))
vi.mock('../orca-profiles/profile-index-store', () => ({ ensureActiveOrcaProfile: store.active }))
vi.mock('../orca-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => '/test-profile'
}))
vi.mock('../orca-profiles/profile-cloud-index', () => ({ linkOrcaProfileToCloud: store.link }))
vi.mock('../orca-profiles/profile-cloud-session-store', () => ({
  saveOrcaCloudSessionExchange: store.save
}))
let directory: string
const origin = 'https://relay.example:8443'
const fixture = () => ({
  origin,
  session: {
    accessToken: 'test-access',
    refreshToken: 'test-refresh',
    expiresAt: Date.now() + 3600000,
    cloud: { userId: 'owner', cloudProfileId: 'owner', email: 'owner@example.test', linkedAt: 1 },
    capabilities: { flags: { 'relay.use': true }, refreshedAt: 1 }
  }
})
function prepare(value = fixture()) {
  const file = join(directory, 'session.json')
  writeFileSync(file, JSON.stringify(value), { mode: 0o600 })
  return { ORCA_CLOUD_API_URL: origin, ORCA_SELFHOST_SESSION_FILE: file }
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'orca-relay-session-'))
  vi.clearAllMocks()
  store.active.mockReturnValue({ profile: { id: 'local-default' } })
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))
describe('headless relay session import', () => {
  it('does nothing unless explicitly configured', async () => {
    await importServeRelaySession({})
    expect(store.save).not.toHaveBeenCalled()
  })
  it('imports a fresh session using the normal profile and session stores', async () => {
    await importServeRelaySession(prepare())
    expect(store.link).toHaveBeenCalledWith(
      'local-default',
      expect.objectContaining({ userId: 'owner' }),
      '/test-profile'
    )
    expect(store.save).toHaveBeenCalledWith(
      'local-default',
      '/test-profile',
      expect.objectContaining({ accessToken: 'test-access' })
    )
  })
  it('rejects an origin mismatch before mutating a profile', async () => {
    const env = prepare({ ...fixture(), origin: 'https://another.example' })
    await expect(importServeRelaySession(env)).rejects.toThrow('origin')
    expect(store.link).not.toHaveBeenCalled()
  })
  it('rejects expired sessions', async () => {
    const value = fixture()
    value.session.expiresAt = 1
    await expect(importServeRelaySession(prepare(value))).rejects.toThrow('fresh')
    expect(store.save).not.toHaveBeenCalled()
  })
  it('rejects sessions without the relay capability', async () => {
    const value = fixture()
    value.session.capabilities.flags['relay.use'] = false
    await expect(importServeRelaySession(prepare(value))).rejects.toThrow('relay.use')
  })
  it('does not overwrite a different linked account', async () => {
    store.active.mockReturnValue({
      profile: { id: 'local-default', cloud: { userId: 'someone-else' } }
    })
    await expect(importServeRelaySession(prepare())).rejects.toThrow('different linked account')
    expect(store.link).not.toHaveBeenCalled()
  })
  it.skipIf(process.platform === 'win32')(
    'rejects credentials readable by other users',
    async () => {
      const env = prepare()
      chmodSync(env.ORCA_SELFHOST_SESSION_FILE, 0o644)
      await expect(importServeRelaySession(env)).rejects.toThrow('0600')
    }
  )
  it('redacts malformed JSON instead of leaking its contents', async () => {
    const env = prepare()
    writeFileSync(env.ORCA_SELFHOST_SESSION_FILE, 'SECRET_NOT_JSON')
    await expect(importServeRelaySession(env)).rejects.toThrow('Cannot parse relay session file')
  })
})
