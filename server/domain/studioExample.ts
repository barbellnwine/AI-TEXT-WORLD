import type { DatabaseSync } from 'node:sqlite'
import { createDraft, DEFAULT_HUMAN_STATE, DEFAULT_EMOTION, type DraftDTO } from './worldDrafts.ts'
import { defaultStudio, defaultCharacter } from './studioConfig.ts'
import { saveStudio } from './studioStore.ts'

export function createTestIsland(db:DatabaseSync):DraftDTO {
  const d=createDraft(db,'테스트 아일랜드')
  d.genre='생존 / 미스터리';d.background='외부와 단절된 시설에서 다섯 명이 깨어난다. 우기가 계속되고 있다.';d.intro='낯선 시설에서 다섯 사람의 하루가 시작된다.';d.seasonName='Season 1';d.rulePresetId='preset-realistic-world';d.targetPopulation=5;d.startWeather='rain';d.startTemperatureC=18;d.startTime='00:00';d.simSpeedMs=60000;d.maxDays=5
  d.places=['중앙홀','숙소','발전실','창고','외부'].map((name,i)=>({id:`place-${i}`,name,description:`${name} 공간`,type:i===4?'실외':'실내',x:i*100,y:0,isPublic:true,isDiscovered:true,capacity:null,resources:i===3?[{key:'food',label:'식량',level:20,max:20,unit:'개'},{key:'water',label:'식수',level:30,max:30,unit:'L'}]:i===2?[{key:'fuel',label:'연료',level:10,max:10,unit:'L'}]:[],items:[],facilityStatus:''}))
  d.connections=d.places.slice(1).map((p,i)=>({id:`edge-${i}`,fromPlaceId:d.places[0].id,toPlaceId:p.id,travelTime:5,connectionType:'PATH',blocked:false,requirements:''}))
  d.characters=['캐릭터 A','캐릭터 B','캐릭터 C','캐릭터 D','캐릭터 E'].map((name,i)=>({id:`char-${i}`,name,age:25+i,gender:i%2?'여성':'남성',appearance:'',background:'시설에서 깨어났다.',occupation:['의사','기술자','연구원','요리사','회사원'][i],personality:'신중함 / 호기심이 많음 / 침착함',goal:'서로 도우며 시설의 정체를 알아낸다.',strengths:['관찰력'],weaknesses:['불신이 강함'],provider:'openai',model:'',humanState:{...DEFAULT_HUMAN_STATE},emotion:{...DEFAULT_EMOTION},knowledge:[],privateInfo:'',inventory:[],initialPlaceId:d.places[0].id,source:'MANUAL',createdAt:'',updatedAt:''}))
  d.studio=defaultStudio();d.studio.climate='우기';d.studio.activeLimit=3;d.studio.minutesPerTick=15
  d.studio.characters=Object.fromEntries(d.characters.map(c=>[c.id,defaultCharacter()]))
  d.studio.items=[{id:'island-flashlight',name:'손전등',kind:'tool',quantity:1,holderKind:'agent',holderId:d.characters[0].id}]
  d.studio.events=[{id:'generator-stop',name:'발전기 고장',description:'발전기가 멈춘다.',day:1,time:'00:00',placeId:d.places[2].id,visibility:'public',effect:'power_off',resourceKey:'',amount:0,goalId:''}]
  d.studio.truths=[{id:'underground-lab',summary:'시설 지하에 숨겨진 연구실이 존재한다.',placeId:d.places[2].id,itemId:'',eventId:'',discoverable:true,knownBy:[],revealedPlaceId:''}]
  d.studio.relationships=[{from:d.characters[0].id,to:d.characters[1].id,kind:'friend'}]
  return saveStudio(db,d.id,d)
}
