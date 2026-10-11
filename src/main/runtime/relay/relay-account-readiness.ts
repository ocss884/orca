import { getOrcaCloudAuthConfig } from '../../orca-profiles/profile-cloud-auth-config'
import { getProfileUserDataPath } from '../../orca-profiles/profile-storage-paths'
import { readRelayAuthContext } from './relay-auth-context'
import type { ServeRelayPairingReadiness } from '../../server/serve-readiness'

export async function readRelayAccountFailure(
  signInGuidance: string
): Promise<Extract<ServeRelayPairingReadiness, { available: false }> | null> {
  const cloudAuth = getOrcaCloudAuthConfig()
  if (!cloudAuth.configured) {
    return { available: false, code: 'relay_cloud_unconfigured', guidance: cloudAuth.setupMessage }
  }
  let context: Awaited<ReturnType<typeof readRelayAuthContext>>
  try {
    context = await readRelayAuthContext(cloudAuth.config, getProfileUserDataPath())
  } catch {
    // Why: a transient read failure is not an account verdict; the mint reports its own failure.
    return null
  }
  if (!context) {
    return { available: false, code: 'relay_sign_in_required', guidance: signInGuidance }
  }
  if (!context.relayEntitled) {
    return {
      available: false,
      code: 'relay_not_entitled',
      guidance: 'The signed-in Orca account does not include Relay access.'
    }
  }
  return null
}
