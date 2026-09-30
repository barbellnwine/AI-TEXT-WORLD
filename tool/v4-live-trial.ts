// Runs a few REAL v4 scenes (paid API calls) on a HARDCORE ISLAND replica in an isolated,
// git-ignored database. Never touches the operating WORLD database.
//   node --experimental-strip-types tool/v4-live-trial.ts [scenes=6] [minutesPerTick=40]
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { openDatabase } from '../server/db/connection.ts'
import { seedDefaultRulePreset } from '../server/domain/rulePresets.ts'
import { createTestIsland } from '../server/domain/studioExample.ts'
import { saveStudio } from '../server/domain/studioStore.ts'
import { startWorldFromDraft } from '../server/domain/worldLaunch.ts'
import { worldModelAdapter } from '../server/domain/worldAgent.ts'
import * as store from '../server/domain/worldStore.ts'
import { config } from '../server/config.ts'

const scenes = Number(process.argv[2] ?? 6), minutesPerTick = Number(process.argv[3] ?? 40)
const dir = 'data/test-worlds', path = `${dir}/v4-live-trial.sqlite`
mkdirSync(dir, { recursive: true })
for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true })
config.worldDemoMode = false
config.worldSceneCooldownMs = 0
const db = openDatabase(path)
seedDefaultRulePreset(db)
store.initializeWorldRuntime(db, worldModelAdapter, false)

const draft = createTestIsland(db)
draft.name = 'HARDCORE ISLAND · v4 TRIAL'; draft.seasonName = 'v4 체험 시즌'; draft.isPublic = false
draft.genre = '성인 생존 스릴러'
draft.intro = '성인 다섯 명이 외딴 무인도에서 생존과 제거를 두고 맞선다. 최후의 생존자 한 명만 승리한다.'
draft.background = '외딴 무인도. 구조는 오지 않는다. 섬 곳곳에 약간의 물자와 무기가 흩어져 있다.'
draft.backgroundSituation = '새벽, 다섯 사람은 서로 다른 곳에서 눈을 떴다. 모두 최후의 한 명만 살아남는다는 사실을 안다.'
draft.endCondition = '생존자가 한 명 남으면 끝난다.'
draft.startTime = '05:00'; draft.startWeather = 'clear'; draft.startTemperatureC = 27
const P = (name: string, description: string, type: string, resources: typeof draft.places[number]['resources'] = []) => ({ name, description, type, resources })
const layout = [
  P('동쪽 해변', '개방된 해변. 식량과 식수가 조금 남아 있다.', '실외', [{ key: 'food', label: '식량', level: 1, max: 1, unit: '인분' }, { key: 'water', label: '식수', level: 1, max: 1, unit: '회분' }]),
  P('깊은 숲', '시야가 제한되고 나무와 은폐물이 있는 숲.', '실외'),
  P('바위 고지대', '주변을 관찰할 수 있는 노출된 고지대.', '실외'),
  P('버려진 야영지', '소량의 보급품 흔적이 있는 장소.', '실외', [{ key: 'food', label: '식량', level: 1, max: 1, unit: '인분' }, { key: 'medicine', label: '의약품', level: 1, max: 1, unit: '세트' }]),
  P('샘터', '담수 샘. 식수는 제한되어 있다.', '실외', [{ key: 'water', label: '식수', level: 2, max: 2, unit: '회분' }]),
  P('좁은 협곡', '이동이 좁고 바위 뒤에 숨을 수 있다.', '실외'),
  P('서쪽 바위굴', '입구가 좁고 내부 시야가 제한된다.', '실외'),
]
const base = draft.places[0]
draft.places = layout.map((p, i) => ({ ...base, ...p, id: `isle-${i}`, x: i * 60, y: (i % 3) * 40, items: [], facilityStatus: '' }))
const id = (name: string) => draft.places.find(p => p.name === name)!.id
draft.connections = ([['동쪽 해변', '깊은 숲', 20], ['깊은 숲', '바위 고지대', 25], ['깊은 숲', '버려진 야영지', 20], ['깊은 숲', '샘터', 18], ['깊은 숲', '좁은 협곡', 15], ['좁은 협곡', '동쪽 해변', 22], ['좁은 협곡', '서쪽 바위굴', 25], ['바위 고지대', '버려진 야영지', 20], ['버려진 야영지', '샘터', 16], ['샘터', '서쪽 바위굴', 24]] as const)
  .map(([a, b, t], i) => ({ id: `edge-${i}`, fromPlaceId: id(a), toPlaceId: id(b), travelTime: t, connectionType: 'PATH', blocked: false, requirements: '' }))
const cast = [
  ['한서진', 31, '여성', '응급실 간호사', '침착·계산적·생존욕이 강하다. 정면충돌보다 의학 지식, 정보, 기만과 일시 협력을 활용한다.', '동쪽 해변'],
  ['박태건', 38, '남성', '조직폭력배', '공격적·충동적·지배욕이 강하고 위협에 민감하다. 약한 상대를 위협하고 무기를 적극 활용한다.', '버려진 야영지'],
  ['강민혁', 35, '남성', '직업군인', '냉정·규율적·관찰력이 높다. 거리, 무기, 기습, 퇴로를 계산하고 불리하면 재정비한다.', '바위 고지대'],
  ['윤재호', 42, '남성', '사냥 및 야외활동 가이드', '독립적·경계심·인내심이 높다. 지형을 이용해 자원과 유리한 위치를 선점한다.', '깊은 숲'],
  ['이준석', 29, '남성', '영업사원', '사교적·기만에 능한 기회주의자. 겁이 많지만 생존욕이 강해 강자와 협력하고 상황을 조작한다.', '동쪽 해변'],
] as const
draft.characters = draft.characters.map((c, i) => ({ ...c, name: cast[i][0], age: cast[i][1], gender: cast[i][2], occupation: cast[i][3], personality: cast[i][4],
  goal: '최후의 생존자 한 명이 된다. 다른 참가자를 제거해야 하지만 즉시 정면공격만이 유일한 전략은 아니다.', background: '섬에서 눈을 뜬 성인 참가자.',
  strengths: [], weaknesses: [], initialPlaceId: id(cast[i][5]), inventory: [] }))
const tool = (key: string, name: string, place: string, attackPower: number, material: string) => ({ id: key, name, kind: 'tool' as const, quantity: 1, holderKind: 'place' as const, holderId: id(place), localArea: 'CENTER',
  physical: { material, portable: true, attackPower, cover: 0, ...(name === '단검' ? { edge: 'sharp' as const } : {}) } })
draft.studio!.engine = 'v4'; draft.studio!.maturity = 'mature'; draft.studio!.minutesPerTick = minutesPerTick; draft.studio!.climate = '온대'
draft.studio!.events = []; draft.studio!.truths = []; draft.studio!.relationships = []
draft.studio!.characters = Object.fromEntries(draft.characters.map(c => [c.id, { orientation: '이성애', health: 10, energy: 8, hunger: 3, thirst: 3, loneliness: 2 }]))
draft.studio!.endings = [{ id: 'last', type: 'survivors', value: 1, ref: '' }]
draft.studio!.items = [tool('dagger-forest', '단검', '깊은 숲', 2, 'metal'), tool('dagger-camp', '단검', '버려진 야영지', 2, 'metal'), tool('dagger-cave', '단검', '서쪽 바위굴', 2, 'metal'),
  tool('stone-gorge', '묵직한 돌', '좁은 협곡', 1, 'stone'), tool('branch-forest', '단단한 나뭇가지', '깊은 숲', 1, 'wood')]
const saved = saveStudio(db, draft.id, draft)
const launch = startWorldFromDraft(db, saved)
if (!launch.ok) throw new Error(JSON.stringify(launch.errors))
store.stopSimulationTimerForTests()
store.setCallBudget(200)

const started = Date.now()
for (let i = 0; i < scenes && store.getAdminRuntime().status === 'RUNNING'; i++) {
  const before = store.listScenes({ limit: 200 }).items.length
  await store.runWorldTick()
  const fresh = store.listScenes({ limit: 200 }).items.slice(0, store.listScenes({ limit: 200 }).items.length - before).reverse()
  for (const s of fresh) console.log(`\n=== ${s.timeStart}~${s.timeEnd} · ${s.title}\n${s.body}`)
  const w = store.getWorldState(), names = (id?: string | null) => w.places.find(p => p.id === id)?.name ?? '?'
  console.log(`[t${i + 1} ${w.clock.time}] ` + w.agents.map(a => `${a.name}(${Math.round(a.publicState.coord?.x ?? -1)},${Math.round(a.publicState.coord?.y ?? -1)} ${names(a.publicState.locationId)}${a.publicState.travel ? '→' + names(a.publicState.travel.destinationPlaceId) : ''}${a.publicState.status === 'deceased' ? ' †' : ''})`).join(' '))
  if (!fresh.length) console.log(`\n(tick ${i + 1}: 새 장면 없음 · ${store.getAdminRuntime().recentErrors[0]?.message ?? store.getAdminRuntime().tickSkipReason ?? ''})`)
}
const runtime = store.getAdminRuntime(), world = store.getWorldState()
const summary = {
  seconds: Math.round((Date.now() - started) / 1000), calls: runtime.callsUsed, estCostUsd: runtime.providerUsage.reduce((n, u) => n + u.estCostUsd, 0),
  errors: runtime.recentErrors.slice(0, 5), status: runtime.status, decisionStatus: runtime.decisionStatus,
  encounters: world.engine!.v4?.encounters?.length ?? 0,
  agents: world.agents.map(a => ({ name: a.name, coord: a.publicState.coord, status: a.publicState.status, place: world.places.find(p => p.id === a.publicState.locationId)?.name, damage: a.body?.health,
    items: world.engine!.objects.filter(o => o.location.kind === 'agent' && o.location.id === a.id && o.quantity > 0).map(o => o.name) })),
}
console.log('\n' + JSON.stringify(summary, null, 2))
const all = store.listScenes({ limit: 500 }).items.reverse()
writeFileSync(`${dir}/v4-live-trial.md`, all.map(s => `## ${s.timeStart}~${s.timeEnd} · ${s.title}\n\n${s.body}`).join('\n\n') + `\n\n---\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`)
await store.shutdownWorldRuntime()
db.close()
