import { DatabaseSync, backup } from 'node:sqlite'
import { resolve, dirname } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
const [source, target] = process.argv.slice(2)
if (!source || !target || !existsSync(source) || existsSync(target) || resolve(source) === resolve(target)) throw new Error('Usage: backup.ts <existing-source.sqlite> <new-target.sqlite>')
mkdirSync(dirname(resolve(target)), { recursive: true })
const db = new DatabaseSync(source, { readOnly: true })
await backup(db, target)
db.close()
const copied = new DatabaseSync(target, { readOnly: true })
if (copied.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('Backup integrity failed')
copied.close()
console.log('Backup complete; integrity ok.')
