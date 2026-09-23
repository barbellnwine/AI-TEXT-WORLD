import { randomUUID } from 'node:crypto'
import type { DraftDTO } from '../domain/worldDrafts.ts'
import type { WorldState, WorldEvent, StateChange, Agent } from '../domain/worldTypes.ts'
import { defaultCharacter, RELATION_VALUES, RELATIONS, WEATHERS, type StudioConfig, type RelationKind } from '../domain/studioConfig.ts'

export interface WeatherState { climateType: string; currentWeather: string; previousWeather: string; temperature: number; humidity: number; rainfall: number; wind: number; weatherDuration: number; day: number }
export interface ExposureState { wetness: number; coldExposure: number; heatExposure: number; weatherExposureDays: number; skinCondition: number; infectionRisk: number; lastExposureDay: number }
export interface StudioRuntime { config: StudioConfig; rng: number; firedEvents: string[]; goals: string[]; ended: boolean; lastExposureMinute: number; endMinute: number | null }
const cap = (n: number) => Math.min(10, Math.max(0, n))
function random(world: WorldState) { const s = world.engine!.studio!; s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0; return s.rng / 4294967296 }
// Picks the single most narratively relevant exposure change instead of the generic
// "환경 노출이 누적되어 상태가 변했다" — viewers couldn't tell what that meant or why.
function exposureLine(name: string, changes: StateChange[], outside: boolean): string {
  const rose = (key: string) => { const c = changes.find(c => c.field.endsWith(`:${key}`)); return c ? Number(c.to) > Number(c.from) : false }
  const touched = (key: string) => changes.some(c => c.field.endsWith(`:${key}`))
  if (touched('injury')) return `${name}의 몸에 이상이 느껴지기 시작했다.`
  if (touched('infectionRisk') && rose('infectionRisk')) return `${name}의 상처 부위가 욱신거리며 덧날 조짐을 보인다.`
  if (touched('skinCondition') && !rose('skinCondition')) return `${name}의 피부가 젖은 채로 오래 지내 짓무르기 시작했다.`
  if (touched('wetness') && rose('wetness')) return `${name}이(가) 비를 맞아 옷이 흠뻑 젖었다.`
  if (touched('coldExposure') && rose('coldExposure')) return `${name}이(가) 추위에 몸을 떨었다.`
  if (touched('heatExposure') && rose('heatExposure')) return `${name}이(가) 더위에 지쳐갔다.`
  if (!outside) return `${name}이(가) 실내에서 몸을 추스르며 조금씩 회복했다.`
  return `${name}의 몸 상태가 날씨의 영향으로 조금씩 변해갔다.`
}
export function engineEvent(world: WorldState, summary: string, changes: StateChange[], placeId = '', agentIds: string[] = []): WorldEvent {
  return { id: randomUUID(), type: 'SYSTEM', occurredAt: new Date().toISOString(), day: world.clock.day, worldTime: world.clock.time, worldMinute: world.engine!.minute, phase: 'STATE_UPDATE', outcome: 'CONFIRMED', title: summary, summary, placeId, agentIds, stateChanges: changes, importance: 'normal', relatedEventIds: [], witnessIds: world.agents.filter(a => !placeId || a.publicState.locationId === placeId).map(a => a.id) }
}
export function initializeStudio(world: WorldState, draft: DraftDTO) {
  if (!draft.studio) return
  const config = structuredClone(draft.studio)
  world.engine!.studio = { config, rng: config.seed >>> 0, firedEvents: [], goals: [], ended: false, lastExposureMinute: world.engine!.minute, endMinute: draft.maxDays === null ? null : (draft.startDay - 1 + draft.maxDays) * 1440 }
  world.engine!.context = { genre: draft.genre, background: draft.background }
  for (const p of world.places) { const d = draft.places.find(d => d.id === p.id)!; p.outdoor = ['실외','자연','위험 지역'].includes(d.type); p.power = draft.powerStatus !== 'OFF'; p.flooded = false; p.accessible = true; p.temperature = draft.startTemperatureC }
  for (const a of world.agents) {
    const spec = config.characters[a.id] ?? defaultCharacter()
    a.profile = { gender: draft.characters.find(c => c.id === a.id)?.gender ?? '', orientation: spec.orientation }
    a.vitals = { health: spec.health, energy: spec.energy, hunger: spec.hunger, thirst: spec.thirst, loneliness: spec.loneliness }
    a.body!.health = 10 - spec.health
    a.humanState!.fatigue = Math.max(a.humanState!.fatigue, 10 - spec.energy)
    a.humanState!.survival_need = Math.max(spec.hunger, spec.thirst)
    a.exposure = { wetness: 0, coldExposure: 0, heatExposure: 0, weatherExposureDays: 0, skinCondition: 10, infectionRisk: 0, lastExposureDay: 0 }
  }
  for (const r of config.relationships) for (const [from,to] of [[r.from,r.to],[r.to,r.from]]) {
    const a = world.agents.find(a => a.id === from), b = world.agents.find(a => a.id === to)
    if (!a || !b) continue
    const [trust,affection,hostility,rivalry] = RELATION_VALUES[r.kind]
    a.relationships = a.relationships.filter(r => r.otherAgentId !== to)
    a.relationships.push({ agentId:from, otherAgentId:to, trust, affection, hostility, rivalry, label:r.kind, interactions:r.kind === 'lover' ? 8 : 0, stance: trust >= 7 ? 'friendly' : hostility >= 7 ? 'hostile' : 'neutral' })
  }
  for (const item of config.items) {
    world.engine!.objects.push({ id:item.id, name:item.name, kind:item.kind, quantity:item.quantity, condition:'intact', location:{kind:item.holderKind,id:item.holderId} })
    if(item.holderKind==='agent') world.agents.find(a=>a.id===item.holderId)?.inventory.push(item.id)
  }
  world.engine!.truths = config.truths.map(t=>({id:t.id,summary:t.summary,placeId:t.discoverable?t.placeId||null:null,revealedPlaceId:t.revealedPlaceId||undefined,discoveredBy:[...t.knownBy],itemId:t.itemId,eventId:t.eventId}))
  for(const t of config.truths) for(const id of t.knownBy) world.agents.find(a=>a.id===id)?.knowledge.push({id:randomUUID(),summary:t.summary,truthId:t.id,learnedAt:new Date().toISOString(),acquisition:'initial',verified:true})
  const initial = draft.startWeather === 'random' ? chooseWeather(world) : draft.startWeather
  updateWeather(world, initial, true)
}
function chooseWeather(world: WorldState): string {
  const s=world.engine!.studio!, climate=s.config.climate
  if(climate==='실내 통제 환경') return 'clear'
  if(world.engine!.weather && random(world)*100<s.config.persistence) return world.engine!.weather.currentWeather
  const rain=climate==='우기'?80:climate==='건기'?10:climate==='사막'?3:climate==='열대'?65:climate==='극한 한랭'?65:s.config.rainChance
  const roll=random(world)*100
  if(roll<rain) return climate==='극한 한랭' ? (random(world)<0.25?'blizzard':'snow') : (random(world)<0.2?'storm':'rain')
  return ['clear','clear','cloudy','fog','wind'][Math.floor(random(world)*5)]
}
function updateWeather(world:WorldState, weather:string, first=false) {
  const s=world.engine!.studio!, old=world.engine!.weather, cold=s.config.climate==='극한 한랭', hot=s.config.climate==='사막'
  const base=cold?-15:hot?38:s.config.climate==='열대'?29:s.config.baseTemperature
  const temperature=first?world.clock.temperatureC:Math.round(base+(random(world)-0.5)*8-(weather==='rain'||weather==='storm'?3:0))
  world.engine!.weather={climateType:s.config.climate,currentWeather:weather,previousWeather:old?.currentWeather??weather,temperature,humidity:['rain','storm','fog'].includes(weather)?90:hot?15:50,rainfall:weather==='storm'?70:weather==='rain'?20:0,wind:['storm','blizzard','wind'].includes(weather)?60:12,weatherDuration:old?.currentWeather===weather?old.weatherDuration+1:1,day:world.clock.day}
  world.clock.weather=weather as WorldState['clock']['weather']
  world.clock.temperatureC=temperature
  for(const p of world.places) p.temperature=p.outdoor?temperature:p.power?20:Math.round((temperature+15)/2)
}
function compatible(a:Agent,b:Agent) { return !!a.profile?.gender && !!b.profile?.gender && (a.profile.orientation==='동성애'?a.profile.gender===b.profile.gender:a.profile.gender!==b.profile.gender) && (b.profile.orientation==='동성애'?a.profile.gender===b.profile.gender:a.profile.gender!==b.profile.gender) }
export function evolveRelationship(_world:WorldState, receiver:Agent, giver:Agent, delta:number, changes:StateChange[]) {
  let r=receiver.relationships.find(r=>r.otherAgentId===giver.id)
  if(!r){r={agentId:receiver.id,otherAgentId:giver.id,stance:'neutral',trust:2,affection:1,label:'stranger'};receiver.relationships.push(r)}
  const before=r.label??'stranger'
  const previous={trust:r.trust??2,affection:r.affection??1,hostility:r.hostility??0,rivalry:r.rivalry??0}
  r.trust=cap(previous.trust+delta); r.affection=cap(previous.affection+delta);r.hostility=cap(previous.hostility-delta);r.rivalry=cap(previous.rivalry-delta)
  r.interactions=(r.interactions??0)+1
  r.label=(r.hostility>=7?'hostile':r.rivalry>=5?'rival':r.trust>=7&&r.affection>=7?'friend':r.trust>=4?'acquaintance':'stranger') as RelationKind
  const reciprocal=giver.relationships.find(x=>x.otherAgentId===receiver.id)
  if(r.trust>=9&&r.affection>=9&&r.interactions>=8&&(reciprocal?.trust??0)>=9&&(reciprocal?.affection??0)>=9&&compatible(receiver,giver)) r.label='lover'
  r.stance=r.label==='hostile'?'hostile':r.label==='rival'?'wary':['friend','lover'].includes(r.label)?'friendly':'neutral'
  for(const k of ['trust','affection','hostility','rivalry'] as const) if(previous[k]!==r[k])changes.push({field:`relationship:${receiver.id}:${giver.id}:${k}`,from:String(previous[k]),to:String(r[k])})
  if(before!==r.label)changes.push({field:`relationship:${receiver.id}:${giver.id}:label`,from:RELATIONS[before],to:RELATIONS[r.label]})
}
export function studioBoundary(world:WorldState,end:number) {
  const s=world.engine?.studio;if(!s)return end
  const deadlines=s.config.events.filter(e=>!s.firedEvents.includes(e.id)).map(e=>(e.day-1)*1440+Number(e.time.slice(0,2))*60+Number(e.time.slice(3)))
  return Math.min(end,s.endMinute!==null&&s.endMinute>world.engine!.minute?s.endMinute:Infinity,(Math.floor(world.engine!.minute/1440)+1)*1440,...deadlines.filter(n=>n>world.engine!.minute))
}
export function processStudio(world:WorldState):WorldEvent[] {
  const engine=world.engine!, s=engine.studio;if(!s)return[]
  const results:WorldEvent[]=[]
  if(s.endMinute!==null&&engine.minute>=s.endMinute){s.ended=true;return results}
  if(engine.weather!.day<world.clock.day){const old=engine.weather!.currentWeather;updateWeather(world,chooseWeather(world));results.push(engineEvent(world,`DAY ${world.clock.day} 날씨: ${WEATHERS[engine.weather!.currentWeather as keyof typeof WEATHERS]}.`,[{field:'weather',from:old,to:engine.weather!.currentWeather}]))}
  for(const e of s.config.events){const at=(e.day-1)*1440+Number(e.time.slice(0,2))*60+Number(e.time.slice(3));if(s.firedEvents.includes(e.id)||at>engine.minute)continue
    const changes:StateChange[]=[], place=world.places.find(p=>p.id===e.placeId)
    if(e.effect==='power_off'||e.effect==='power_on'){const on=e.effect==='power_on';for(const p of place?[place]:world.places){changes.push({field:`place:${p.id}:power`,from:String(p.power),to:String(on)});p.power=on}engine.environment.powerStatus=on?'ON':'OFF'}
    if(e.effect==='flood'&&place){place.flooded=true;place.accessible=false;changes.push({field:`place:${place.id}:flooded`,from:'false',to:'true'})}
    if(e.effect==='resource'&&place){const r=place.resources.find(r=>r.key===e.resourceKey);if(r){const before=r.level;r.level=Math.min(r.max,Math.max(0,r.level+e.amount));changes.push({field:`place:${place.id}:${r.key}`,from:String(before),to:String(r.level)})}}
    if(e.effect==='goal'&&e.goalId){s.goals.push(e.goalId);changes.push({field:`goal:${e.goalId}`,from:'pending',to:'achieved'})}
    s.firedEvents.push(e.id)
    const ev=engineEvent(world,`${e.name}: ${e.description}`,changes,e.placeId);ev.cause=`scheduled:${e.id}`;ev.visibility=e.visibility;ev.importance='high';if(e.visibility==='private'){ev.witnessIds=[];ev.agentIds=[]}results.push(ev)
  }
  if(engine.minute>=s.lastExposureMinute+60){s.lastExposureMinute=engine.minute
    const w=engine.weather!
    for(const p of world.places){const changes:StateChange[]=[]
      if(p.outdoor&&w.currentWeather==='storm'&&w.weatherDuration>=2&&!p.flooded){p.flooded=true;p.accessible=false;changes.push({field:`place:${p.id}:flooded`,from:'false',to:'true'})}
      if(p.flooded&&w.currentWeather==='clear'){p.flooded=false;p.accessible=true;changes.push({field:`place:${p.id}:flooded`,from:'true',to:'false'})}
      for(const r of p.resources){const loss=(r.key==='food'&&(p.outdoor&&w.rainfall>=70||w.temperature>=35))?0.1:(r.key==='fuel'&&w.temperature<0&&p.power)?0.1:0;if(loss&&r.level>0){const from=r.level;r.level=Math.max(0,Math.round((r.level-loss)*100)/100);changes.push({field:`place:${p.id}:${r.key}`,from:String(from),to:String(r.level)})}}
      for(const obj of engine.objects.filter(o=>o.location.kind==='place'&&o.location.id===p.id&&o.quantity>0)){if(p.outdoor&&w.rainfall>=70&&obj.kind==='food'){const from=obj.quantity;obj.quantity=Math.max(0,obj.quantity-1);if(!obj.quantity)obj.condition='destroyed';changes.push({field:`object:${obj.id}:quantity`,from:String(from),to:String(obj.quantity)})}}
      if(changes.length)results.push(engineEvent(world,`${p.name}의 환경과 자원이 날씨의 영향을 받았다.`,changes,p.id))
    }
    for(const a of world.agents.filter(a=>a.publicState.status!=='deceased')){const x=a.exposure!,p=world.places.find(p=>p.id===a.publicState.locationId);const outside=p?.outdoor&&s.config.climate!=='실내 통제 환경';const before=structuredClone(x);const changes:StateChange[]=[]
      if(outside){if(x.lastExposureDay!==world.clock.day){x.weatherExposureDays++;x.lastExposureDay=world.clock.day}x.wetness=cap(x.wetness+(w.rainfall>0?1:-0.2));x.coldExposure=cap(x.coldExposure+(w.temperature<5?0.4:-0.2));x.heatExposure=cap(x.heatExposure+(w.temperature>=35?0.4:-0.2))}else{x.wetness=cap(x.wetness-0.3);x.coldExposure=cap(x.coldExposure-0.2);x.heatExposure=cap(x.heatExposure-0.2)}
      if(x.wetness>=5&&x.weatherExposureDays>=3)x.skinCondition=cap(x.skinCondition-0.1)
      if(x.skinCondition<5)x.infectionRisk=cap(x.infectionRisk+0.1)
      for(const k of ['wetness','coldExposure','heatExposure','weatherExposureDays','skinCondition','infectionRisk'] as const)if(before[k]!==x[k])changes.push({field:`agent:${a.id}:${k}`,from:String(before[k]),to:String(x[k])})
      if(outside&&(w.rainfall||w.temperature<0||w.temperature>=35)){const from=a.humanState!.fatigue;a.humanState!.fatigue=cap(from+0.2);changes.push({field:`agent:${a.id}:fatigue`,from:String(from),to:String(a.humanState!.fatigue)})}
      if(x.coldExposure>=8||x.skinCondition<4){const from=a.body!.injury;a.body!.injury=cap(from+0.1);a.publicState.status='injured';changes.push({field:`agent:${a.id}:injury`,from:String(from),to:String(a.body!.injury)})}
      const v=a.vitals!;v.energy=cap(10-a.humanState!.fatigue);v.hunger=cap(v.hunger+0.2);v.thirst=cap(v.thirst+(outside&&w.temperature>=35?0.5:0.2));v.health=cap(10-a.body!.health);v.loneliness=cap(v.loneliness+(world.agents.some(b=>b.id!==a.id&&b.publicState.locationId===a.publicState.locationId)?-0.1:0.1));a.humanState!.survival_need=Math.max(v.hunger,v.thirst)
      if(changes.length){const ev=engineEvent(world,exposureLine(a.name,changes,Boolean(outside)),changes,a.publicState.locationId,[a.id]);ev.cause='environment_exposure';results.push(ev)}
    }
  }
  const rules=s.config.endings
  const met=rules.map(e=>e.type==='day'?world.clock.day>=e.value:e.type==='survivors'?world.agents.filter(a=>a.publicState.status!=='deceased').length<=e.value:e.type==='all_dead'?world.agents.every(a=>a.publicState.status==='deceased'):e.type==='place'?world.agents.some(a=>a.publicState.status!=='deceased'&&a.publicState.locationId===e.ref):e.type==='event'?s.firedEvents.includes(e.ref):s.goals.includes(e.ref))
  if(met.length&&(s.config.endMode==='AND'?met.every(Boolean):met.some(Boolean)))s.ended=true
  return results
}
