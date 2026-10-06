import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { loginSelfhostRelay } from './selfhost-relay-login.mjs'
let directory, env
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orca-relay-login-'))
  env = {
    ORCA_CLOUD_API_URL: 'https://relay.example:8443',
    ORCA_SELFHOST_PASSWORD_FILE: join(directory, 'password'),
    ORCA_SELFHOST_SESSION_FILE: join(directory, 'session')
  }
  await writeFile(env.ORCA_SELFHOST_PASSWORD_FILE, 'test-password', { mode: 0o600 })
})
afterEach(async () => {
  await rm(directory, { force: true, recursive: true })
})
function transport({ badState = false, badOrigin = false, expired = false } = {}) {
  let challenge
  return vi.fn(async (url, options) => {
    if (url.endsWith('/authorize')) {
      expect(options.redirect).toBe('manual')
      expect(options.body.get('password')).toBe('test-password')
      challenge = options.body.get('code_challenge')
      const callback = new URL(
        badOrigin ? 'https://attacker.example/auth/callback' : options.body.get('redirect_uri')
      )
      callback.searchParams.set('state', badState ? 'wrong' : options.body.get('state'))
      callback.searchParams.set('code', 'test-code')
      return new Response(null, { status: 303, headers: { location: callback.toString() } })
    }
    const body = JSON.parse(options.body)
    expect(createHash('sha256').update(body.codeVerifier).digest('base64url')).toBe(challenge)
    expect(body.code).toBe('test-code')
    return Response.json({
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
      expiresAt: expired ? 1 : Date.now() + 3600000,
      capabilities: { flags: { 'relay.use': true } },
      cloud: { userId: 'owner', cloudProfileId: 'owner' }
    })
  })
}
it('exchanges PKCE code and atomically writes a private origin-bound session', async () => {
  const request = transport()
  await loginSelfhostRelay(env, request)
  expect(request).toHaveBeenCalledTimes(2)
  expect(JSON.parse(await readFile(env.ORCA_SELFHOST_SESSION_FILE, 'utf8'))).toMatchObject({
    origin: env.ORCA_CLOUD_API_URL,
    session: { accessToken: 'test-access' }
  })
  if (process.platform !== 'win32') {
    expect((await stat(env.ORCA_SELFHOST_SESSION_FILE)).mode & 0o777).toBe(0o600)
  }
})
it.each([{ badState: true }, { badOrigin: true }])(
  'rejects a substituted callback: %j',
  async (options) => {
    const request = transport(options)
    await expect(loginSelfhostRelay(env, request)).rejects.toThrow('callback')
    expect(request).toHaveBeenCalledTimes(1)
  }
)
it('does not overwrite an existing session on login failure', async () => {
  await writeFile(env.ORCA_SELFHOST_SESSION_FILE, 'old-session')
  await expect(loginSelfhostRelay(env, transport({ expired: true }))).rejects.toThrow('expired')
  expect(await readFile(env.ORCA_SELFHOST_SESSION_FILE, 'utf8')).toBe('old-session')
})
it('rejects plaintext origins before transmitting the password', async () => {
  const request = vi.fn()
  await expect(
    loginSelfhostRelay({ ...env, ORCA_CLOUD_API_URL: 'http://relay.example' }, request)
  ).rejects.toThrow('HTTPS')
  expect(request).not.toHaveBeenCalled()
})
