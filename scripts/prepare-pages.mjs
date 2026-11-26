import { access, cp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const build = new URL('../dist/', import.meta.url)
const site = new URL('../site/', import.meta.url)
for (const file of ['index.html', 'manifest.webmanifest', 'sw.js']) {
  await access(new URL(file, build))
}
await rm(site, { recursive: true, force: true })
await cp(fileURLToPath(build), fileURLToPath(site), { recursive: true })
