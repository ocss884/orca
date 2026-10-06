import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createServePairingOffer,
  persistServeRelayPairing,
  registerServeRelayPairingRefresh
} from './serve-relay-pairing'
import type { ServeOptions } from './serve-options'
const storage = vi.hoisted(() => ({ write: vi.fn(() => true) }))
vi.mock('../../shared/secure-file', () => ({ writeSecureJsonFile: storage.write }))
const unavailable = {
  available: false,
  reason: 'websocket_unavailable',
  guidance: 'Not ready'
} as const
const server = () => ({
  createPairingOffer: vi.fn(() => unavailable),
  createMobilePairingOffer: vi.fn(async () => unavailable)
})
const options: ServeOptions = {
  json: true,
  pairingAddress: '127.0.0.1',
  noPairing: false,
  mobilePairing: true,
  recipeJson: false,
  projectRoot: null
}
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  storage.write.mockReturnValue(true)
})
describe('serve pairing selection', () => {
  it('preserves direct pairing without opt-in', async () => {
    const rpc = server()
    await createServePairingOffer(rpc, options, {})
    expect(rpc.createPairingOffer).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'mobile' })
    )
    expect(rpc.createMobilePairingOffer).not.toHaveBeenCalled()
  })
  it('uses native automatic relay pairing when opted in', async () => {
    const rpc = server()
    await createServePairingOffer(rpc, options, { ORCA_SELFHOST_RELAY_PAIRING: '1' })
    expect(rpc.createMobilePairingOffer).toHaveBeenCalledWith(
      expect.objectContaining({ connectionMode: 'automatic' })
    )
    expect(rpc.createPairingOffer).not.toHaveBeenCalled()
  })
  it('does not provision when pairing is disabled', async () => {
    const rpc = server()
    expect(
      await createServePairingOffer(
        rpc,
        { ...options, noPairing: true },
        { ORCA_SELFHOST_RELAY_PAIRING: '1' }
      )
    ).toMatchObject({ available: false, reason: 'disabled_by_operator' })
    expect(rpc.createMobilePairingOffer).not.toHaveBeenCalled()
  })
  it('does not turn a runtime invite into mobile access silently', async () => {
    await expect(
      createServePairingOffer(
        server(),
        { ...options, mobilePairing: false },
        { ORCA_SELFHOST_RELAY_PAIRING: '1' }
      )
    ).rejects.toThrow('--mobile-pairing')
  })
  it('persists unavailable results so stale invites are replaced', () => {
    persistServeRelayPairing(unavailable, 'runtime-1', {
      ORCA_SELFHOST_RELAY_PAIRING: '1',
      ORCA_SELFHOST_PAIRING_FILE: '/private/pairing.json'
    })
    expect(storage.write).toHaveBeenCalledWith(
      '/private/pairing.json',
      expect.objectContaining({ runtimeId: 'runtime-1', pairing: unavailable })
    )
  })
  it('fails if pairing credentials cannot be protected', () => {
    storage.write.mockReturnValue(false)
    expect(() =>
      persistServeRelayPairing(unavailable, 'runtime-1', {
        ORCA_SELFHOST_RELAY_PAIRING: '1',
        ORCA_SELFHOST_PAIRING_FILE: '/private/pairing.json'
      })
    ).toThrow('permissions')
  })
  it.skipIf(process.platform === 'win32')(
    'refreshes once for overlapping signals without restarting or publishing readiness again',
    async () => {
      vi.stubEnv('ORCA_SELFHOST_RELAY_PAIRING', '1')
      vi.stubEnv('ORCA_SELFHOST_PAIRING_FILE', '/private/pairing.json')
      const before = process.listeners('SIGUSR2')
      const rpc = server()
      registerServeRelayPairingRefresh(rpc, options, 'runtime-1')
      try {
        process.emit('SIGUSR2')
        process.emit('SIGUSR2')
        expect(rpc.createMobilePairingOffer).toHaveBeenCalledTimes(1)
        await vi.waitFor(() => expect(storage.write).toHaveBeenCalled())
      } finally {
        for (const listener of process.listeners('SIGUSR2')) {
          if (!before.includes(listener)) {
            process.removeListener('SIGUSR2', listener)
          }
        }
      }
    }
  )
})
