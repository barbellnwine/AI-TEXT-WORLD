import {existsSync,mkdirSync} from 'node:fs'
import {openDatabase} from '../server/db/connection.ts'
import {seedDefaultRulePreset} from '../server/domain/rulePresets.ts'
import {createTestIsland} from '../server/domain/studioExample.ts'
import {saveStudio} from '../server/domain/studioStore.ts'

// Creates a draft in a separate, git-ignored database. It does not launch a season,
// advance a tick, call a model, or mutate the operating WORLD database.
const path='data/test-worlds/adult-survival-thriller.sqlite'
if(existsSync(path))throw new Error(`Isolated test database already exists: ${path}`)
mkdirSync('data/test-worlds',{recursive:true})
const db=openDatabase(path)
try{
  seedDefaultRulePreset(db)
  const draft=createTestIsland(db)
  draft.name='성인 생존 스릴러 — 사건 연쇄 검증'
  draft.seasonName='독립 사건 검증 시즌'
  draft.genre='성인 생존 스릴러'
  draft.background='외부와 단절된 산악 대피소. 모든 등장인물은 성인이다. 사건의 결과는 엔진 상태와 목격 정보에 근거해 기록한다.'
  draft.intro='다섯 성인이 산악 대피소에서 서로의 안전을 경계한다.'
  draft.isPublic=false
  draft.targetPopulation=5
  draft.startTime='08:00'
  draft.places=['대피소','진입로','숲길','응급실','감시 지점'].map((name,i)=>({
    ...draft.places[i],name,description:`${name} 구역`,type:i===0||i===3?'실내':'실외',
    resources:i===3?[{key:'medicine',label:'응급 처치 물품',level:2,max:2,unit:'세트'}]:[],
  }))
  const cast=[
    ['서하린',28,'여성','응급구조사','안전을 확보하고 자신의 선택권을 지킨다.'],
    ['강도윤',34,'남성','시설 관리인','위협을 피하고 탈출 경로를 찾는다.'],
    ['이민재',31,'남성','기자','사건을 확인하고 생존자를 돕는다.'],
    ['박현우',37,'남성','경비원','대피소의 안전을 관리한다.'],
    ['최유진',42,'여성','의사','부상자를 치료하고 안전한 장소를 찾는다.'],
  ] as const
  draft.characters=draft.characters.map((character,i)=>({
    ...character,name:cast[i][0],age:cast[i][1],gender:cast[i][2],occupation:cast[i][3],goal:cast[i][4],
    background:'산악 대피소에 도착한 성인 생존자.',personality:['신중함','충동적','관찰력이 높음','경계심이 강함','침착함'][i],
    initialPlaceId:draft.places[i===4?3:0].id,
  }))
  draft.studio!.events=[]
  draft.studio!.items=[]
  draft.studio!.truths=[]
  draft.studio!.relationships=[]
  const saved=saveStudio(db,draft.id,draft)
  console.log(JSON.stringify({database:path,draftId:saved.id,status:saved.status,characters:saved.characters.map(c=>({name:c.name,age:c.age,gender:c.gender})),launched:false,apiCalls:0}))
}finally{db.close()}
