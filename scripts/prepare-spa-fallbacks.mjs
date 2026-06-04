import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(fileURLToPath(import.meta.url))
const distRoot = join(repoRoot, '..', 'dist')
const indexPath = join(distRoot, 'index.html')
const fallbackRoutes = ['image', 'chat', 'works', 'auth/confirm', 'auth/callback']

await readFile(indexPath, 'utf8')

await Promise.all(
  fallbackRoutes.map(async (route) => {
    const targetPath = join(distRoot, route, 'index.html')
    await mkdir(dirname(targetPath), { recursive: true })
    await copyFile(indexPath, targetPath)
  }),
)

console.log(`Prepared SPA fallback files for ${fallbackRoutes.length} route(s).`)
