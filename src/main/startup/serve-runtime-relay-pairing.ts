import { readRelayAccountFailure } from '../runtime/relay/relay-account-readiness'
import type { RuntimeDeviceGrant } from '../runtime/rpc/rpc-caller-scope'
import type { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'
import type {
  PairingOfferUnavailable,
  RuntimeRelayPairingOffer
} from '../runtime/runtime-rpc/runtime-rpc-pairing-types'
import type { ServeRelayPairingReadiness } from '../server/serve-readiness'

export type ServeRelayPairingOffer = Omit<RuntimeRelayPairingOffer, 'relay'> & {
  relay: ServeRelayPairingReadiness
}

const SIGN_IN_GUIDANCE =
  'Sign this Orca profile in to an Orca account with Relay access (for example from the Orca desktop app on this machine), then restart orca serve --relay. The direct pairing link above still works.'

// Why: the Relay coordinator reports both "signed out" and "not entitled" as offline, so
// the person sharing needs this read to learn which account step is missing.

export async function createServeRelayPairingOffer(
  runtimeRpc: Pick<OrcaRuntimeRpcServer, 'createPairingOffer' | 'createRuntimeRelayPairingOffer'>,
  args: { address: string | null; name: string; grants?: readonly RuntimeDeviceGrant[] }
): Promise<PairingOfferUnavailable | ServeRelayPairingOffer> {
  const accountFailure = await readRelayAccountFailure(SIGN_IN_GUIDANCE)
  if (accountFailure) {
    const direct = runtimeRpc.createPairingOffer({ ...args, scope: 'runtime' })
    return direct.available ? { ...direct, relay: accountFailure } : direct
  }
  const offer = await runtimeRpc.createRuntimeRelayPairingOffer(args)
  if (!offer.available) {
    return offer
  }
  return {
    ...offer,
    relay: offer.relay.available
      ? {
          available: true,
          url: offer.relay.pairingUrl,
          inviteExpiresAt: offer.relay.inviteExpiresAt
        }
      : {
          available: false,
          code: offer.relay.failure.code,
          guidance: `${offer.relay.failure.message}. Check outbound HTTPS access to Orca Relay and restart orca serve --relay, or pair with the direct link.`
        }
  }
}
