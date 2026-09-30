import {randomUUID} from 'node:crypto'
import type {Agent,WorldEvent,WorldState} from '../domain/worldTypes.ts'

export const FUNCTIONS=['vision','mobility','dexterity','attention'] as const
export type FunctionName=typeof FUNCTIONS[number]
export interface InjuryProposal {
 part:'HEAD'|'TORSO'|'ARM'|'LEG'; type:'abrasion'|'laceration'|'contusion'|'fracture'; site:'general'|'scalp'|'face'|'eye'
 severity:number;bleeding:number;pain:number;healingHours:number
 effects:Array<{basis?:string;function:FunctionName;degree:number;mechanism:'pain'|'blood_obstruction'|'structural'}>
}
export interface Injury extends InjuryProposal {id:string;sourceEventId:string;onset:number;treatedAt:number|null;healed:boolean}
export interface TraumaState {version:1;lastMinute:number;bloodLoss:number;pain:number;functions:Record<FunctionName,number>;injuries:Injury[]}
const emptyFunctions=()=>({vision:0,mobility:0,dexterity:0,attention:0})
export function traumaState(a:Agent,minute:number){return a.trauma??={version:1,lastMinute:minute,bloodLoss:0,pain:0,functions:emptyFunctions(),injuries:[]}}
// Shared anatomical/function compatibility, not a list of injury scenarios.
const capabilities={HEAD:['vision','attention'],TORSO:['mobility','attention'],ARM:['dexterity','attention'],LEG:['mobility','attention']} as const
export function injuryIssue(raw:unknown,maxSeverity:number):string|null{
 if(!raw||typeof raw!=='object')return 'invalid_injury'
 const w=raw as InjuryProposal
 if(!Object.hasOwn(capabilities,w.part)||!['abrasion','laceration','contusion','fracture'].includes(w.type)||!['general','scalp','face','eye'].includes(w.site))return 'invalid_anatomy'
 if(w.site!=='general'&&w.part!=='HEAD')return 'site_part_mismatch'
 if(!Number.isInteger(w.severity)||w.severity<1||w.severity>maxSeverity)return 'severity_out_of_bounds'
 if(!Number.isFinite(w.bleeding)||w.bleeding<0||w.bleeding>w.severity||!Number.isFinite(w.pain)||w.pain<0||w.pain>w.severity*3)return 'injury_intensity_out_of_bounds'
 if(!Number.isFinite(w.healingHours)||w.healingHours<1||w.healingHours>168||!Array.isArray(w.effects)||w.effects.length>4)return 'invalid_recovery_or_effects'
 const seen=new Set<string>()
 for(const e of w.effects){
  if(!e||!(capabilities[w.part] as readonly string[]).includes(e.function)||seen.has(e.function)||!['pain','blood_obstruction','structural'].includes(e.mechanism))return 'unsupported_function_effect'
  seen.add(e.function)
  if(!Number.isFinite(e.degree)||e.degree<0||e.degree>Math.min(.9,w.severity*.3)+1e-9)return 'effect_out_of_bounds'
  if(e.mechanism==='blood_obstruction'&&(w.bleeding<=0||e.function!=='vision'||w.part!=='HEAD'||!['face','eye','scalp'].includes(w.site)))return 'blood_obstruction_without_supported_bleeding'
  if(e.mechanism==='pain'&&w.pain===0)return 'pain_effect_without_pain'
 }
 return null
}
function recompute(a:Agent,minute:number){
 const t=a.trauma!;t.functions=emptyFunctions();t.pain=0
 for(const w of t.injuries.filter(w=>!w.healed)){
  const recovery=Math.max(0,1-(minute-w.onset)/(w.healingHours*60)*(w.treatedAt===null?1:1.5))
  t.pain=Math.max(t.pain,w.pain*recovery)
  for(const e of w.effects){const scale=e.mechanism==='blood_obstruction'?Math.min(1,w.bleeding):recovery;t.functions[e.function]=Math.min(.95,t.functions[e.function]+e.degree*scale)}
 }
 const systemic=Math.max(0,t.bloodLoss-.1)
 t.functions.mobility=Math.min(.95,t.functions.mobility+systemic)
 t.functions.attention=Math.min(.95,t.functions.attention+systemic)
}
export function addInjury(a:Agent,w:InjuryProposal,eventId:string,minute:number){
 const t=traumaState(a,minute)
 if(t.injuries.some(i=>i.sourceEventId===eventId))return
 t.injuries.push({...structuredClone(w),id:randomUUID(),sourceEventId:eventId,onset:minute,treatedAt:null,healed:false});recompute(a,minute)
}
export function treatInjuries(a:Agent,minute:number){
 if(!a.trauma)return false
 let changed=false
 for(const w of a.trauma.injuries.filter(w=>!w.healed&&w.treatedAt===null)){w.treatedAt=minute;changed=true}
 return changed
}
const bands=(t:TraumaState)=>JSON.stringify([Math.floor(t.bloodLoss*10),...FUNCTIONS.map(k=>Math.floor(t.functions[k]*4)),t.injuries.filter(w=>!w.healed).map(w=>Math.ceil(w.bleeding))])
// Fictional simulation units, not medical predictions. One-minute integration keeps large
// ticks from skipping deterioration/death and costs no API calls.
export function progressTrauma(world:WorldState,minute:number):WorldEvent[]{
 const events:WorldEvent[]=[]
 for(const a of world.agents){
  const t=a.trauma;if(!t||a.publicState.status==='deceased'||minute<=t.lastMinute)continue
  const before=JSON.stringify(t),band=bands(t),oldStatus=a.publicState.status,oldBody={...a.body}
  for(let m=t.lastMinute+1;m<=minute;m++){
   let loss=0
   for(const w of t.injuries.filter(w=>!w.healed)){
    loss+=w.bleeding*w.bleeding*.00023
    w.bleeding=Math.max(0,w.bleeding-(w.treatedAt!==null?.06:w.severity===1?.02:.0005))
    if(m-w.onset>=w.healingHours*60*(w.treatedAt===null?1:2/3)){w.healed=true;w.bleeding=0;if(a.body){a.body.injury=Math.max(0,a.body.injury-w.severity);a.body.health=Math.max(0,a.body.health-w.severity);if(a.vitals)a.vitals.health=10-a.body.health}}
   }
   t.bloodLoss=Math.max(0,Math.min(1,t.bloodLoss+loss-(loss===0?.0002:0)))
   t.lastMinute=m;recompute(a,m)
   if(t.bloodLoss>=.45){a.publicState.status='deceased';a.body!.health=10;if(a.vitals)a.vitals.health=0;a.nextDecisionAt=Number.MAX_SAFE_INTEGER;break}
  }
  if(before===JSON.stringify(t))continue
  if(a.publicState.status==='injured'&&!t.injuries.some(w=>!w.healed)&&a.body!.injury===0&&a.body!.health<8)a.publicState.status='alive'
  const dead=a.publicState.status==='deceased',changed=band!==bands(t)
  if(!changed&&!dead&&oldStatus===a.publicState.status)continue
  const summary=dead?`${a.name}은(는) 출혈이 지속되어 사망했다.`:`${a.name}의 부상 경과로 ${FUNCTIONS.filter(k=>t.functions[k]>=.25).map(k=>({vision:'시야',mobility:'이동',dexterity:'손 사용',attention:'집중'}[k])).join('·')||'몸 상태'}에 변화가 생겼다.`
  const id=randomUUID()
  events.push({id,occurredAt:new Date().toISOString(),day:Math.floor(t.lastMinute/1440)+1,worldMinute:t.lastMinute,worldTime:`${String(Math.floor(t.lastMinute%1440/60)).padStart(2,'0')}:${String(t.lastMinute%60).padStart(2,'0')}`,placeId:a.publicState.locationId,agentIds:[a.id],witnessIds:[a.id],type:'SYSTEM',phase:'STATE_UPDATE',cause:dead?'injury_deterioration_death':'injury_progression',title:summary,summary,stateChanges:[...(['health','injury'] as const).filter(k=>oldBody[k]!==a.body?.[k]).map(k=>({field:`agent:${a.id}:${k}`,from:String(oldBody[k]),to:String(a.body?.[k])})),{field:`agent:${a.id}:trauma`,from:before,to:JSON.stringify(t)},...(oldStatus!==a.publicState.status?[{field:`agent:${a.id}:status`,from:oldStatus,to:a.publicState.status}]:[])],relatedEventIds:[...new Set(t.injuries.map(w=>w.sourceEventId))],importance:dead?'critical':'normal',visibility:'public'})
 }
 return events
}
