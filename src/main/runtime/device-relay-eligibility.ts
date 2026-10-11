import type { DeviceEntry } from './device-registry'

// Runtime grants opt into Relay through a minted binding. Mobile grants retain
// upstream's automatic fallback unless the operator explicitly selected local-only.
export function isDeviceRelayEnabled(device: DeviceEntry | null): boolean {
  if (device?.scope === 'runtime') {
    return device.relayBinding !== undefined
  }
  return device?.scope === 'mobile' && device.mobilePairingConnectionMode !== 'local-only'
}
