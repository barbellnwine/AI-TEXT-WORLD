// Deterministic, isolated acceptance run. Never opens the production database or a provider API.
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
process.env.AI_WORLD_DEMO_MODE='true'
const {openDatabase}=await import('../server/db/connection.ts')
const {seedDefaultRulePreset}=await import('../server/domain/rulePresets.ts')
const {createTestIsland}=await import('../server/domain/studioExample.ts')
const {startWorldFromDraft}=await import('../server/domain/worldLaunch.ts')
const store=await import('../server/domain/worldStore.ts')
mkdirSync('data/studio-tests',{recursive:true})
const path=`data/studio-tests/island-${randomUUID()}.sqlite`
const db=openDatabase(path);seedDefaultRulePreset(db);store.initializeWorldRuntime(db)
const draft=createTestIsland(db)
startWorldFromDraft(db,draft);store.stopSimulationTimerForTests()
let ticks=0
while(store.getAdminRuntime().status==='RUNNING'&&ticks<480){await store.runWorldTick();ticks++}
const world=store.getWorldState()
const report={database:path,draftId:draft.id,mode:store.getAdminRuntime().mode,ticks,finalDay:world.clock.day,status:store.getAdminRuntime().status,callsUsed:store.getAdminRuntime().callsUsed,weather:world.engine!.weather,characters:world.agents.map(a=>({name:a.name,status:a.publicState.status,exposure:a.exposure})),generatorPower:world.places.find(p=>p.name==='발전실')!.power,items:world.engine!.objects.map(o=>({name:o.name,quantity:o.quantity})),firedEvents:world.engine!.studio!.firedEvents}
writeFileSync('data/studio-tests/latest-report.json',JSON.stringify(report,null,2))
console.log(JSON.stringify({database:path,days:report.finalDay,ticks,status:report.status,paidCalls:report.callsUsed}))
await store.shutdownWorldRuntime();db.close()
