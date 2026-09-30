import {DatabaseSync} from 'node:sqlite'
import assert from 'node:assert/strict'
import {migrate} from '../server/db/connection.ts'
import {seedDefaultRulePreset} from '../server/domain/rulePresets.ts'
import {createTestIsland} from '../server/domain/studioExample.ts'
import {saveStudio} from '../server/domain/studioStore.ts'
import {startWorldFromDraft} from '../server/domain/worldLaunch.ts'
import * as store from '../server/domain/worldStore.ts'
import {config} from '../server/config.ts'
import {beginAction,advanceEngine,recordExperience} from '../server/world/worldEngine.ts'
import {DEFAULT_DISPOSITIONS} from '../server/world/dispositions.ts'
import type {WorldModelAdapter} from '../server/domain/worldAgent.ts'
import type {WorldEvent} from '../server/domain/worldTypes.ts'
import type {InjuryProposal} from '../server/world/trauma.ts'
export function traumaFixture(adapter?:WorldModelAdapter){
 const db=new DatabaseSync(':memory:');migrate(db);seedDefaultRulePreset(db);store.initializeWorldRuntime(db,adapter,false);config.worldDemoMode=!adapter
 const draft=createTestIsland(db);draft.startWeather='clear';draft.studio!.events=[];draft.studio!.items=[{id:'rock',name:'돌',kind:'tool',quantity:2,holderKind:'place',holderId:draft.places[0].id,localArea:'CENTER',physical:{material:'stone',portable:true,attackPower:2,cover:0}}];draft.studio!.relationships=[]
 const d=saveStudio(db,draft.id,draft);assert.equal(startWorldFromDraft(db,d).ok,true);store.stopSimulationTimerForTests()
 const world=store.getWorldState(),[a,b]=world.agents,place=world.places[0],events:WorldEvent[]=[]
 for(const a of world.agents){a.body={health:0,injury:0};a.humanState!.fatigue=0;a.humanState!.survival_need=0;a.vitals!.hunger=0;a.vitals!.thirst=0;a.publicState.locationId=place.id;a.publicState.localArea='CENTER';a.dispositions={...DEFAULT_DISPOSITIONS,riskTolerance:10,aggression:10,competitiveness:10};a.emotion!.fear=0;a.nextDecisionAt=100000;a.inventory=[]}
 world.engine!.requireCombatAdjudication=true;world.engine!.lastVitalsMinute=100000;world.engine!.studio!.lastExposureMinute=100000
 const attack=(actor=a,target=b,aim:'HEAD'|'TORSO'|'ARM'|'LEG'='HEAD')=>{const start=beginAction(world,{actorId:actor.id,locationId:place.id,targetIds:[target.id],actionType:'ATTACK',pickupItemId:actor===a?'rock':undefined,aim,intendedAction:'접근 가능한 도구로 공격을 시도한다',publicReason:'상대의 위협에서 벗어나려 했다.'});events.push(start);return world.engine!.ongoingActions.find(t=>t.proposal.actorId===actor.id)!}
 const tick=(n:number)=>advanceEngine(world,n,events,e=>{events.push(e);recordExperience(world,e)})
 return {db,draft:d,world,a,b,place,events,attack,tick,async close(){await store.shutdownWorldRuntime();db.close()}}
}
export const headInjury:InjuryProposal={part:'HEAD',site:'scalp',type:'laceration',severity:2,bleeding:1.5,pain:4,healingHours:12,effects:[{function:'vision',degree:.4,mechanism:'blood_obstruction',basis:'두피 상처의 피가 눈 쪽으로 흘러 시야 일부를 가린다.'}]}
