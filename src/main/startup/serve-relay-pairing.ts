import { createServeRelayPairingOffer } from './serve-runtime-relay-pairing'
import { isAbsolute } from 'node:path'
import type { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'
import { writeSecureJsonFile } from '../../shared/secure-file'
import type { ServeOptions } from './serve-options'

type PairingServer = Pick<
  OrcaRuntimeRpcServer,
  'createPairingOffer' | 'createMobilePairingOffer' | 'createRuntimeRelayPairingOffer'
>

export async function createServePairingOffer(
  server: PairingServer,
  options: ServeOptions,
  env = process.env
) {
  if (options.noPairing) {
    return {
      available: false,
      reason: 'disabled_by_operator',
      guidance: 'Restart without --no-pairing to create a client pairing offer.'
    } as const
  }
  const name = `${options.mobilePairing ? 'Mobile' : 'CLI'} ${new Date().toLocaleDateString()}`
  if (options.relay && !options.mobilePairing) {
    return createServeRelayPairingOffer(server, {
      address: options.pairingAddress,
      name,
      grants: options.grantDesktopControl ? ['desktop-control'] : []
    })
  }
  if (options.relay || env.ORCA_SELFHOST_RELAY_PAIRING === '1') {
    if (!options.mobilePairing) {
      throw new Error('ORCA_SELFHOST_RELAY_PAIRING requires --mobile-pairing')
    }
    return await server.createMobilePairingOffer({
      address: options.pairingAddress,
      connectionMode: 'automatic',
      name
    })
  }
  return server.createPairingOffer({
    address: options.pairingAddress,
    name,
    scope: options.mobilePairing ? 'mobile' : 'runtime',
    grants: options.grantDesktopControl ? ['desktop-control'] : []
  })
}

type ServePairing = Awaited<ReturnType<typeof createServePairingOffer>>

export function persistServeRelayPairing(
  pairing: ServePairing,
  runtimeId: string,
  env = process.env
): void {
  const file = env.ORCA_PAIRING_FILE ?? env.ORCA_SELFHOST_PAIRING_FILE
  if (!file) {
    return
  }
  if (!isAbsolute(file)) {
    throw new Error('ORCA_PAIRING_FILE must be absolute')
  }
  // Keep unavailable results too, so an old invite is never mistaken for current readiness.
  if (!writeSecureJsonFile(file, { runtimeId, generatedAt: Date.now(), pairing })) {
    throw new Error('Could not restrict relay pairing file permissions')
  }
}

export function registerServeRelayPairingRefresh(
  server: PairingServer,
  options: ServeOptions,
  runtimeId: string
): void {
  if (
    process.platform === 'win32' ||
    !(process.env.ORCA_PAIRING_FILE ?? process.env.ORCA_SELFHOST_PAIRING_FILE) ||
    options.noPairing
  ) {
    return
  }
  let pending = false
  process.on('SIGUSR2', () => {
    if (pending) {
      return
    }
    pending = true
    void createServePairingOffer(server, options)
      .then((pairing) => persistServeRelayPairing(pairing, runtimeId))
      .catch(() => console.error('[serve] Relay pairing refresh failed'))
      .finally(() => {
        pending = false
      })
  })
}
