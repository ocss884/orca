import type { RuntimePairingIntent } from './runtime-pairing-link-state'
import { translate } from '@/i18n/i18n'

export function RuntimePairingIntentPicker({
  intent,
  onIntentChange
}: {
  intent: RuntimePairingIntent
  onIntentChange: (intent: RuntimePairingIntent) => void
}): React.JSX.Element {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        {translate(
          'auto.components.settings.RuntimePairingUrlGenerator.intentQuestion',
          'Where will this link be opened?'
        )}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {(
          [
            [
              'another',
              translate(
                'auto.components.settings.RuntimePairingUrlGenerator.anotherDevice',
                'Another device'
              ),
              translate(
                'auto.components.settings.RuntimePairingUrlGenerator.anotherDeviceHelp',
                'Tailscale, LAN, or another reachable address'
              )
            ],
            [
              'local',
              translate(
                'auto.components.settings.RuntimePairingUrlGenerator.localOnly',
                'This computer only'
              ),
              translate(
                'auto.components.settings.RuntimePairingUrlGenerator.localOnlyHelp',
                'A browser or Orca client on this computer'
              )
            ],
            [
              'custom',
              translate(
                'auto.components.settings.RuntimePairingUrlGenerator.customAddress',
                'Custom address'
              ),
              translate(
                'auto.components.settings.RuntimePairingUrlGenerator.customAddressHelp',
                'SSH tunnel, reverse proxy, or custom hostname'
              )
            ],
            [
              'relay',
              translate(
                'auto.components.settings.RuntimePairingUrlGenerator.anyNetwork',
                'Any network'
              ),
              translate(
                'auto.components.settings.RuntimePairingUrlGenerator.anyNetworkHelp',
                'Through Orca Relay when there is no direct path'
              )
            ]
          ] as const
        ).map(([value, label, description]) => (
          <label
            key={value}
            className="flex cursor-pointer gap-2 rounded-md border border-border p-3 has-[:checked]:border-ring has-[:checked]:ring-1 has-[:checked]:ring-ring"
          >
            <input
              type="radio"
              name="runtime-pairing-intent"
              value={value}
              checked={intent === value}
              onChange={() => onIntentChange(value)}
              className="mt-0.5"
            />
            <span className="space-y-1">
              <span className="block text-xs font-medium">
                {label}
                {value === 'another' ? (
                  <span className="ml-1.5 text-[11px] text-muted-foreground">
                    {translate(
                      'auto.components.settings.RuntimePairingUrlGenerator.recommended',
                      'Recommended'
                    )}
                  </span>
                ) : null}
              </span>
              <span className="block text-[11px] text-muted-foreground">{description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
