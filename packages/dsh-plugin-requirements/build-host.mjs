import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

// Bundle local domain modules with the host entry: reloading only index.js leaves
// transitive native ESM imports cached in a long-running Desktop process.
const directory = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
let outfile = resolve(directory, 'host.bundle.js')
let sourceBuildId = null
for (let index = 0; index < args.length; index += 2) {
  const key = args[index], value = args[index + 1]
  if (key === '--outfile' && value && resolve(value) === resolve(directory, '../../tmp/native-delivery/host.bundle.js')) outfile = resolve(value)
  else if (key === '--source-build-id' && /^[a-f0-9]{64}$/.test(value ?? '')) sourceBuildId = value
  else throw new Error('Unsupported native delivery build argument')
}
const clientSource = await readFile(resolve(directory, 'client-source.js'), 'utf8')
const clientBuildId = createHash('sha256').update(clientSource).digest('hex')
const definitions = { __ALM_SOURCE_BUILD_ID__: JSON.stringify(sourceBuildId), __ALM_CLIENT_BUILD_ID__: JSON.stringify(clientBuildId) }
await build({
  entryPoints: [resolve(directory, 'client-source.js')],
  outfile: resolve(dirname(outfile), 'client.js'),
  bundle: false,
  platform: 'browser',
  format: 'esm',
  define: definitions,
})
await build({
  entryPoints: [resolve(directory, 'index.js')],
  outfile,
  define: definitions,
  bundle: true,
  platform: 'node',
  banner: { js: "import { createRequire as __hostCreateRequire } from 'node:module'; const require = __hostCreateRequire(import.meta.url);" },
  format: 'esm',
  target: 'node22',
  plugins: [{
    name: 'preserve-module-resource-locations',
    setup(builder) {
      builder.onLoad({ filter: /\.(?:mjs|js)$/ }, async ({ path }) => {
        const source = await readFile(path, 'utf8')
        // Keep resource URLs relative to their original module, not the bundle.
        // Relative URLs also survive moving the complete workspace to a new path.
        const modulePath = './' + relative(directory, path).replaceAll('\\', '/')
        const contents = source.replaceAll('import.meta.url', `new URL(${JSON.stringify(modulePath)}, import.meta.url).href`)
        return { contents, loader: 'js', resolveDir: dirname(path) }
      })
    },
  }],
})
