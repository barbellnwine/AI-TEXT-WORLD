import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

try { process.loadEnvFile() } catch { /* deployment injects environment variables */ }
const knownSecrets = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_COMMUNITY_ADMIN_TOKEN']
  .map(name => process.env[name]).filter(value => value && value.length >= 8)

function check(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { check(path); continue }
    const bytes = readFileSync(path)
    if (knownSecrets.some(secret => bytes.includes(Buffer.from(secret))) ||
        /sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/.test(bytes.toString('utf8'))) {
      // Never include either the secret value or its matching source line in logs.
      throw new Error('Public build contains a possible secret. Publication blocked.')
    }
  }
}
check(resolve('dist'))
console.log('Public build secret check passed.')
