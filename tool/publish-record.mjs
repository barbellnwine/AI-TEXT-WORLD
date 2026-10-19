import {readFileSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const [base,credentialsPath,recordPath,backupPath,...expectedIds]=process.argv.slice(2)
if(!backupPath)throw new Error('Usage: publish-record.mjs <base> <env|credentials-json> <record-json> <new-backup-json> [expected-id ...]')
// `env` reads the administrator from the environment, so the password never lands on disk.
// Pair it with `railway run` to use the service's own ADMIN_SEED_* without copying them anywhere.
const credentials=credentialsPath==='env'
 ?{username:process.env.ADMIN_SEED_USERNAME,password:process.env.ADMIN_SEED_PASSWORD}
 :JSON.parse(readFileSync(credentialsPath,'utf8'))
if(!credentials.username||!credentials.password)throw new Error('Administrator username and password are required')
const record=JSON.parse(readFileSync(recordPath,'utf8'))
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:credentials.username,password:credentials.password})})
assert.equal(login.status,200,'Administrator login must succeed')
const cookie=login.headers.get('set-cookie').split(';')[0]
try{
 const before=await fetch(base+'/api/admin/records',{headers:{Cookie:cookie}})
 assert.equal(before.status,200)
 writeFileSync(backupPath,JSON.stringify(await before.json(),null,2),{flag:'wx'})
 const result=await fetch(base+'/api/admin/records',{method:'PUT',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(record)})
 assert.equal(result.status,200,await result.text())
 const published=await fetch(`${base}/api/records/${record.id}`)
 assert.equal(published.status,200)
 const actual=(await published.json()).record
 assert.deepEqual(actual.sections,record.sections)
 assert.equal(actual.coverImage,record.coverImage)
 assert.deepEqual((actual.episodes||[]).map(e=>e.title),(record.episodes||[]).map(e=>e.title))
 const listing=await(await fetch(base+'/api/records')).json()
 const ids=listing.records.map(r=>r.id)
 // Guard the archive roster: publishing one record must not quietly add or drop another.
 if(expectedIds.length)assert.deepEqual([...ids].sort(),[...expectedIds].sort(),`Archive should list ${expectedIds.join(', ')} but lists ${ids.join(', ')}`)
 console.log(`Published ${record.id}: ${record.sections.length} original sections, ${(record.episodes||[]).length} incident records, cover ${record.coverImage}. Archive now lists: ${ids.join(', ')}.`)
}finally{await fetch(base+'/api/auth/logout',{method:'POST',headers:{Cookie:cookie}})}
