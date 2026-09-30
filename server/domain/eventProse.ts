// Shared, deterministic presentation of public facts. Never changes simulation state.
export function koreanParticles(text: string): string {
  return text.replace(/뇌의 의도에 따라\s*/g, '').replace(/([가-힣])(?:이\(가\)|을\(를\)|은\(는\)|과\(와\))/g, (whole, last: string) => {
    const final = (last.charCodeAt(0) - 0xac00) % 28 !== 0
    const pair = whole.slice(1)
    return last + (pair === '이(가)' ? (final ? '이' : '가') : pair === '을(를)' ? (final ? '을' : '를') : pair === '은(는)' ? (final ? '은' : '는') : (final ? '과' : '와'))
  })
}

interface ProseEvent {
  detail?:import('../world/engineTypes.ts').ActionDetail
  actionResult?: string
  actionMotive?: string
  cause?: string
  actionContext?: string
  summary: string; phase?: string; actionType?: string; agentIds: string[]; publicQuote?: string
  stateChanges: Array<{ field: string; from: string; to: string }>
}
export function eventProse(event: ProseEvent, names: Map<string, { name: string }>): string {
  if(event.detail?.combat&&['COMPLETED','FAILED'].includes(event.phase??'')){
    const c=event.detail.combat,w=event.detail.adjudication?.proposal.injury
    const actor=names.get(c.attackerId)?.name??'공격자',target=names.get(c.targetId)?.name??'상대'
    const part={HEAD:'머리',TORSO:'몸통',ARM:'팔',LEG:'다리'}[c.aimedPart]
    const pickup=event.detail.steps.find(s=>s.kind==='PICK_UP')?.text
    const defense=['BLOCK','DODGE'].includes(c.reaction.kind)?event.detail.steps.find(s=>s.kind==='DEFEND')?.text:undefined
    const approach=c.tool.source==='unarmed'?`${actor}은(는) ${target}의 ${part}을(를) 향해 주먹을 뻗었다.`:`${actor}은(는) ${c.tool.name}을(를) 쥐고 ${target}의 ${part}을(를) 공격했다.`
    const result=c.outcome==='DODGED'?`${target}은(는) 몸을 빼 피했다.`:c.outcome==='BLOCKED'?`${target}은(는) 공격을 막았다.`:c.outcome==='MISSED'?`공격은 ${target}에게 닿지 않았다.`:w?`${target}은(는) ${w.site==='face'?'얼굴':w.site==='eye'?'눈가':w.part==='HEAD'?'머리':w.part==='TORSO'?'몸통':w.part==='ARM'?'팔':'다리'}에 ${{contusion:'타박상',abrasion:'찰과상',laceration:'열상',fracture:'골절'}[w.type]}을(를) 입었다.${w.bleeding>0?' 피가 흘렀다.':''}`:c.damage>0?`${target}은(는) 충격으로 부상을 입었다.`:`${target}은(는) 맞았지만 새 부상은 없었다.`
    return koreanParticles([pickup,approach,defense,result].filter(Boolean).join(' '))
  }
  if(event.detail?.steps.length&&['COMPLETED','FAILED'].includes(event.phase??'')){
    const d=event.detail
    const witnesses=d.steps.filter(s=>s.kind==='WITNESS')
    const steps=d.steps.filter(s=>witnesses.length<2||s.kind!=='WITNESS').map(s=>s.text)
    if(witnesses.length>=2)steps.push(`주변의 ${witnesses.length}명도 ${d.combat?'충돌을':'자원을 사용하는 모습을'} 목격했다.`)
    return koreanParticles(steps.filter(Boolean).join(' '))
  }
  if (event.actionResult && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(event.phase ?? '')) {
    if (event.phase === 'CANCELLED') {
      const name = names.get(event.agentIds[0])?.name
      if (name && /이 공격으로/.test(event.actionResult)) return koreanParticles(`${name}은(는) 공격을 받아 ${event.actionType === 'ATTACK' ? '반격을' : '하던 행동을'} 끝내지 못했다.`)
    }
    return koreanParticles(event.actionResult)
  }
  if (event.cause?.startsWith('scheduled:') && event.stateChanges.some(c => c.field.endsWith(':power'))) {
    const off = event.stateChanges.filter(c => c.field.endsWith(':power')).every(c => c.to === 'false')
    return off ? '예약된 전력 차단이 실행되어 전기 공급이 꺼졌다.' : '예약된 전력 공급 변경이 실행되어 전기가 들어왔다.'
  }
  if (event.summary.includes('수준에 이르렀다')) return koreanParticles(event.summary
    .replace(/젖은 정도가 높아져 (가벼운|뚜렷한|심한|위험한) 수준에 이르렀다/g, (_m, grade: string) => grade === '가벼운' ? '옷이 젖기 시작했다' : grade === '뚜렷한' ? '옷이 한층 더 젖었다' : '옷이 흠뻑 젖었다')
    .replace(/피로가 높아져 (가벼운|뚜렷한|심한|위험한) 수준에 이르렀다/g, (_m, grade: string) => grade === '가벼운' ? '몸에 피로가 쌓이기 시작했다' : grade === '뚜렷한' ? '피로가 뚜렷해졌다' : grade === '심한' ? '피로가 심해졌다' : '피로가 탈진 위험 수준에 이르렀다')
    .replace(/허기가 높아져 가벼운 수준에 이르렀다/g, '허기가 느껴지기 시작했다')
    .replace(/갈증가 높아져 가벼운 수준에 이르렀다/g, '갈증이 느껴지기 시작했다'))
  if (event.actionContext) return koreanParticles(event.summary)
  const name = names.get(event.agentIds[0])?.name
  if (name && event.phase === 'STARTED') {
    if (event.actionType === 'USE_ITEM' && event.summary.endsWith('부상을 치료하려 의약품을 준비했다.')) return koreanParticles(event.summary)
    if (event.actionType === 'EXPLORE' && event.summary.endsWith('쪽으로 향했다.')) return koreanParticles(event.summary)
    const verbs: Record<string, string> = { MOVE: '길을 나섰다', REST: '쉬기 시작했다', SLEEP: '잠을 청했다', WAIT: '잠시 기다리기로 했다', OBSERVE: '주변을 살피기 시작했다', EXPLORE: '주변을 탐색하기 시작했다', SPEAK: '말을 건네기 시작했다', TAKE_ITEM: '필요한 물자를 챙기려 했다', COOPERATE: '협력에 나섰다', INTERACT: '계획한 작업에 착수했다', ATTACK: '공격을 시도했다', EAT: '음식을 먹으려 했다', DRINK: '물을 마시려 했다', SHARE_INFO: '알고 있는 사실을 전하려 했다', USE_ITEM: '물건을 사용하려 했다', GIVE_ITEM: '물건을 건네려 했다', DROP_ITEM: '물건을 내려놓으려 했다' }
    return koreanParticles(`${name}은(는) ${verbs[event.actionType ?? ''] ?? '행동에 나섰다'}.`)
  }
  if (name && (event.summary.includes('환경 노출이 누적') || event.phase === 'STATE_UPDATE' && event.stateChanges.some(c => /:(wetness|coldExposure|heatExposure|skinCondition|infectionRisk)$/.test(c.field)))) {
    const changed = (key: string, up = true) => event.stateChanges.some(c => c.field.endsWith(`:${key}`) && (up ? Number(c.to) > Number(c.from) : Number(c.to) < Number(c.from)))
    const fact = changed('injury') ? '몸 상태가 더 나빠졌다' : changed('skinCondition', false) ? '피부 상태가 나빠졌다' : changed('wetness') ? '몸이 한층 더 젖었다' : changed('coldExposure') ? '추위의 영향이 커졌다' : changed('heatExposure') ? '더위의 영향이 커졌다' : changed('wetness', false) ? '몸에서 물기가 조금씩 말랐다' : changed('fatigue') ? '피로가 더 쌓였다' : '몸 상태에 변화가 생겼다'
    return `${name}의 ${fact}.`
  }
  return koreanParticles(event.summary)
}

// Consecutive identical environmental effects form one sentence, not one alert per person.
export function compactProse(sentences: string[], names: Map<string, { name: string }>): string[] {
  const result: Array<{ text: string; people: string[]; tail?: string }> = []
  for (const text of sentences.flatMap(s => s.includes('수준에 이르렀다') || s.includes('의 옷이') ? s.split(/(?<=\.)\s+/).filter(Boolean) : [s])) {
    const name = [...names.values()].find(a => text.startsWith(`${a.name}의 `))?.name
    const tail = name ? text.slice(name.length) : undefined
    const exposure = tail && /^의 (몸이 한층 더 젖었다|추위의 영향이 커졌다|더위의 영향이 커졌다|몸에서 물기가 조금씩 말랐다|피로가 더 쌓였다|피부 상태가 나빠졌다|몸 상태가 더 나빠졌다|옷이 젖기 시작했다|옷이 한층 더 젖었다|옷이 흠뻑 젖었다|몸에 피로가 쌓이기 시작했다|피로가 뚜렷해졌다|피로가 심해졌다|피로가 탈진 위험 수준에 이르렀다|허기가 느껴지기 시작했다|갈증이 느껴지기 시작했다)\.$/.test(tail)
    let boundary = result.length - 1
    while (boundary >= 0 && result[boundary].tail) boundary--
    const previous = exposure ? result.slice(boundary + 1).find(r => r.tail === tail) : undefined
    if (name && exposure && previous?.tail === tail && !previous.people.includes(name)) {
      previous.people.push(name)
      previous.text = previous.people.join(', ') + tail
    } else result.push({ text, people: name ? [name] : [], tail: exposure ? tail : undefined })
  }
  return result.map(r => r.text)
}
