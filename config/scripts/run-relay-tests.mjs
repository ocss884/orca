import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const tests = [
  'config/scripts/selfhost-relay-login.test.mjs',
  'src/cli/index-serve-command.test.ts',
  'src/cli/runtime/launch-serve-runtime.test.ts',
  'src/cli/runtime/serve-orcad-launch.test.ts',
  'src/main/startup/serve-relay-session.test.ts',
  'src/main/startup/serve-relay-pairing.test.ts',
  'src/main/startup/serve-runtime-relay-pairing.test.ts',
  'src/main/startup/serve-options.test.ts',
  'src/main/startup/serve-mode-argv.test.ts',
  'src/main/server/serve-readiness.test.ts',
  'src/main/runtime/runtime-rpc-relay-provider-install.test.ts',
  'src/main/runtime/runtime-rpc-relay-pairing.test.ts',
  'src/main/runtime/runtime-rpc-runtime-relay-pairing.test.ts',
  'src/main/runtime/runtime-rpc-pairing-mode-persistence.test.ts',
  'src/main/runtime/runtime-pairing-desktop-control-grant.test.ts',
  'src/main/runtime/delegated-mobile-device.integration.test.ts',
  'src/main/runtime/rpc/rpc-caller-scope.test.ts',
  'src/main/runtime/rpc/methods/pairing.test.ts',
  'src/main/runtime/relay/desktop-relay-service.test.ts',
  'src/main/runtime/relay/relay-demand-ledger.test.ts',
  'src/main/runtime/relay/mobile-relay-e2ee.integration.test.ts',
  'src/main/runtime/relay/relay-revoke-outbox.test.ts',
  'src/main/ipc/runtime-relay-share.test.ts',
  'src/main/ipc/runtime-environment-relay-route.test.ts',
  'src/main/ipc/runtime-environment-relay.integration.test.ts',
  'src/main/ipc/runtime-environments-pairing.test.ts',
  'src/shared/mobile-relay-pairing-offer.test.ts',
  'src/shared/remote-pairing-address.test.ts',
  'src/shared/runtime-environment-store.test.ts',
  'src/shared/serve-option-validation.test.ts',
  'src/renderer/src/components/settings/RuntimePairingGeneratorForm.test.tsx',
  'src/renderer/src/components/settings/RuntimePairingUrlGenerator.test.tsx',
  'src/renderer/src/components/settings/runtime-server-route-label.test.ts',
  'src/renderer/src/components/sidebar/AddRemoteHostFields.test.tsx'
]

const result = spawnSync(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    '--config',
    'config/vitest.config.ts',
    '--maxWorkers=4',
    ...tests
  ],
  { cwd: root, stdio: 'inherit', env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' } }
)
if (result.error) {
  throw result.error
}
process.exitCode = result.status ?? 1
