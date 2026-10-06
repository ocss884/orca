import { createHash, randomBytes } from 'node:crypto'
import { lstat, readFile, mkdir, rename, writeFile, rm } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function loginSelfhostRelay(env = process.env, request = fetch) {
  const origin = env.ORCA_CLOUD_API_URL
  const passwordFile = env.ORCA_SELFHOST_PASSWORD_FILE
  const output = env.ORCA_SELFHOST_SESSION_FILE
  if (!origin || new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin) {
    throw new Error('ORCA_CLOUD_API_URL must be an HTTPS origin')
  }
  if (
    !passwordFile ||
    !output ||
    !isAbsolute(passwordFile) ||
    !isAbsolute(output) ||
    passwordFile === output
  ) {
    throw new Error(
      'Set distinct absolute ORCA_SELFHOST_PASSWORD_FILE and ORCA_SELFHOST_SESSION_FILE paths'
    )
  }
  const stat = await lstat(passwordFile)
  if (
    !stat.isFile() ||
    stat.size > 65536 ||
    (process.platform !== 'win32' && (stat.mode & 0o077 || stat.uid !== process.getuid?.()))
  ) {
    throw new Error('Password file must be a private regular file owned by the service user')
  }
  const password = (await readFile(passwordFile, 'utf8')).trim()
  if (!password) {
    throw new Error('Password file is empty')
  }
  const verifier = randomBytes(32).toString('base64url')
  const state = randomBytes(24).toString('base64url')
  const redirectUri = 'http://127.0.0.1:31987/auth/callback'
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.ORCA_CLOUD_CLIENT_ID || 'orca-desktop',
    redirect_uri: redirectUri,
    state,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    password
  })
  const response = await request(`${origin}/v1/desktop/auth/authorize`, {
    method: 'POST',
    body: params,
    redirect: 'manual',
    signal: AbortSignal.timeout(30000)
  })
  const location = response.headers.get('location')
  await response.body?.cancel()
  if (response.status !== 303 || !location) {
    throw new Error(`Relay login rejected (${response.status})`)
  }
  const callback = new URL(location)
  if (
    callback.origin + callback.pathname !== redirectUri ||
    callback.searchParams.get('state') !== state ||
    !callback.searchParams.get('code')
  ) {
    throw new Error('Invalid relay login callback')
  }
  const sessionResponse = await request(`${origin}/v1/desktop/auth/session`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: callback.searchParams.get('code'),
      codeVerifier: verifier,
      redirectUri
    })
  })
  if (!sessionResponse.ok) {
    await sessionResponse.body?.cancel()
    throw new Error(`Relay session exchange rejected (${sessionResponse.status})`)
  }
  const session = await sessionResponse.json()
  if (
    typeof session.accessToken !== 'string' ||
    !session.accessToken ||
    typeof session.refreshToken !== 'string' ||
    !session.refreshToken ||
    !Number.isFinite(session.expiresAt) ||
    session.expiresAt <= Date.now() + 60000 ||
    session.capabilities?.flags?.['relay.use'] !== true ||
    !session.cloud?.userId ||
    !session.cloud?.cloudProfileId
  ) {
    throw new Error('Invalid or expired relay session')
  }
  await mkdir(dirname(output), { recursive: true, mode: 0o700 })
  const temporary = `${output}.${randomBytes(8).toString('hex')}.tmp`
  try {
    await writeFile(temporary, JSON.stringify({ origin, session }), { mode: 0o600, flag: 'wx' })
    await rename(temporary, output)
  } finally {
    await rm(temporary, { force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loginSelfhostRelay()
    .then(() => console.log('Relay login succeeded; private session written'))
    .catch(() => {
      console.error('Relay login failed; check origin, CA, password file and service availability')
      process.exitCode = 1
    })
}
