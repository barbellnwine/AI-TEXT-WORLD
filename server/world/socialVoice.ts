import type {Agent,WorldState} from '../domain/worldTypes.ts'
export function speechContext(actor:Agent,target:Agent){
 const r=actor.relationships.find(r=>r.otherAgentId===target.id)
 const hostile=r?.stance==='hostile'||(r?.hostility??0)>=7
 const close=(r?.trust??0)>=7||r?.label==='friend'||r?.label==='lover'
 const older=actor.age!=null&&target.age!=null&&target.age-actor.age>=5
 return {speakerAge:actor.age??null,listenerAge:target.age??null,relation:r?.label??r?.stance??'unknown',tone:hostile?'firm':close?'familiar':older?'respectful':'polite',anger:actor.emotion?.anger??0,fear:actor.emotion?.fear??0}
}
export function contextualSpeech(world:WorldState,actorId:string,targetId:string,text:string){
 const a=world.agents.find(a=>a.id===actorId)!,b=world.agents.find(a=>a.id===targetId)!
 const c=speechContext(a,b)
 if(c.tone==='familiar')return `${b.name}, ${text}`
 const polite=text.replace(/줄 수 있어\?/g,'주실 수 있나요?').replace(/있을까\?/g,'있을까요?').replace(/받아들이겠어\./g,'받아들이겠습니다.').replace(/어려워\./g,'어렵습니다.')
 if(c.tone==='firm')return `${b.name}, ${a.emotion?.anger&&a.emotion.anger>=6?'내 말 들어. ':''}${text}`
 return `${b.name} 씨, ${c.tone==='respectful'?'부탁드립니다. ':''}${polite}`
}
