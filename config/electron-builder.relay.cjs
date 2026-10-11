const { createHash } = require('node:crypto')
const { readFileSync, writeFileSync, readdirSync } = require('node:fs')
const { join, relative } = require('node:path')
const { execFileSync } = require('node:child_process')
const official = require('./electron-builder.config.cjs')

// Keep the official identity, paths, native guards and packaging hooks.
module.exports = {
  ...official,
  publish: { provider: 'github', owner: 'ocss884', repo: 'orca', releaseType: 'draft' },
  extraResources: [...(official.extraResources ?? []), { from: 'out/relay-service', to: 'relay' }],
  afterPack: async (context) => {
    await official.afterPack(context)
    const root =
      context.electronPlatformName === 'darwin'
        ? join(
            context.appOutDir,
            `${context.packager.appInfo.productFilename}.app`,
            'Contents',
            'Resources'
          )
        : join(context.appOutDir, 'resources')
    const paths = [
      'app.asar',
      ...[
        'selfhost-relay-login.mjs',
        'run-selfhost-relay.sh',
        'configure-selfhost-relay.py',
        'verify-selfhost-relay.py'
      ].map((name) => `relay/${name}`),
      ...readdirSync(join(root, 'app.asar.unpacked', 'out'), {
        recursive: true,
        withFileTypes: true
      })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    ]
    const manifest = {
      release: context.packager.appInfo.version,
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      upstreamCommit: '398cb846ff16a5abfb9350309842c16a3fe8148a',
      upstreamSshTemplate: '57452c681f27c03fd3c016a06da6315777db775a',
      platform: context.electronPlatformName,
      architecture: ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][context.arch],
      files: Object.fromEntries(
        paths.sort().map((path) => [
          path.split('\\').join('/'),
          createHash('sha256')
            .update(readFileSync(join(root, path)))
            .digest('hex')
        ])
      )
    }
    writeFileSync(join(root, 'BUILD-INFO.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  }
}
