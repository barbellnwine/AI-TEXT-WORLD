import {readFileSync,writeFileSync} from 'node:fs'
import {agentRequest,worldRequestBody} from '../server/domain/worldAgent.ts'
import {prepareDecision} from '../server/world/decisionController.ts'
const snapshot=JSON.parse(readFileSync('data/repetition-checkpoint.json','utf8'))
const before=JSON.stringify(snapshot)
const results=snapshot.world.agents.map((a:any)=>{
 const w=structuredClone(snapshot.world)
 const request=agentRequest(snapshot.execution,a.id,w,snapshot.events,prepareDecision(w,a.id,snapshot.events))
 return {name:a.name,requestBytes:Buffer.byteLength(worldRequestBody(request)),promptBytes:Buffer.byteLength(request.prompt)}
})
if(JSON.stringify(snapshot)!==before)throw Error('Snapshot mutated')
writeFileSync('docs/repetition-context-check.json',JSON.stringify({source:'Read-only production snapshot; private text redacted; offline request construction, no API calls or ticks',clock:snapshot.world.clock,status:snapshot.world.status,limit:20000,results},null,2))
console.log(JSON.stringify(results))
