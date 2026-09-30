import {randomUUID} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
type Request={role:string;model:string;provider:string;prompt:string;schema:unknown;maxOutputTokens?:number}
let db:DatabaseSync|undefined
const ids=new WeakMap<object,string>()
export function initializeModelTrace(database:DatabaseSync){db=database;db.exec('CREATE TABLE IF NOT EXISTS world_model_trace (id TEXT PRIMARY KEY, at TEXT NOT NULL, payload TEXT NOT NULL)')}
export function redactTrace(value:unknown):unknown{
 if(typeof value==='string')return value.replace(/"(?:privateInfo|hiddenNotes|hiddenWorldTruth|password)"\s*:\s*"(?:\\.|[^"\\])*"/gi,'"private":"[REDACTED]"').replace(/sk-[A-Za-z0-9_-]+/g,'[REDACTED]').replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[EMAIL]').slice(0,65000)
 if(Array.isArray(value))return value.map(redactTrace)
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/password|api.?key|authorization|cookie|privateInfo|hiddenNotes|hiddenWorldTruth/i.test(k)?'[REDACTED]':redactTrace(v)]))
 return value
}
function put(id:string,payload:object){if(!db)return;try{db.prepare('INSERT INTO world_model_trace VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(id,new Date().toISOString(),JSON.stringify(payload));db.exec('DELETE FROM world_model_trace WHERE id NOT IN (SELECT id FROM world_model_trace ORDER BY at DESC LIMIT 200)')}catch{/* Telemetry must not change simulation outcomes. */}}
export function listModelTraces(){return db?(db.prepare('SELECT payload FROM world_model_trace ORDER BY at DESC LIMIT 200').all() as {payload:string}[]).map(r=>JSON.parse(r.payload)):[]}
export function traceOutcome(request:Request,output:unknown,fallback:boolean){
 const id=ids.get(request);if(!id||!db)return
 const row=db.prepare('SELECT payload FROM world_model_trace WHERE id=?').get(id) as {payload:string}|undefined;if(!row)return
 const p=JSON.parse(row.payload);p.fallback=fallback;if(p.capture)p.finalOutput=redactTrace(output);put(id,p)
}
export function tracePreparationFailure(request:Request,error:unknown){put(randomUUID(),{purpose:request.role+'-preparation',model:request.model,promptBytes:Buffer.byteLength(request.prompt),elapsedMs:0,error:(error as {code?:string}).code??'PREPARATION_FAILED',fallback:false})}
export async function traceModel<T extends {raw:unknown;inputTokens:number;outputTokens:number}>(request:Request,call:()=>Promise<T>,wireBytes?:number):Promise<T>{
 const id=randomUUID(),start=Date.now();ids.set(request,id)
 const capture=process.env.AI_WORLD_CAPTURE_TRACE==='true'&&process.env.NODE_ENV!=='production'
 const purpose=request.prompt.startsWith('Check every factual assertion')?'narrator-review':request.prompt.startsWith('You propose consequences')?'combat-adjudication':request.role
 const p={id,purpose,model:request.model,provider:request.provider,inputBytes:wireBytes??Buffer.byteLength(JSON.stringify(request)),promptBytes:Buffer.byteLength(request.prompt),maxOutputTokens:request.maxOutputTokens,capture,...(capture?{request:redactTrace(request)}:{})}
 try{const result=await call();put(id,{...p,elapsedMs:Date.now()-start,error:null,fallback:false,inputTokens:result.inputTokens,outputTokens:result.outputTokens,...(capture?{response:redactTrace(result.raw)}:{})});return result}
 catch(error){put(id,{...p,elapsedMs:Date.now()-start,error:(error as {code?:string}).code??'MODEL_CALL_FAILED',fallback:request.role==='narrator'});throw error}
}
