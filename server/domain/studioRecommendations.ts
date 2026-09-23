import type { DatabaseSync } from 'node:sqlite'
import type { DraftDTO } from './worldDrafts.ts'
import { config } from '../config.ts'
import { fetchWithLimits, ProviderCallError } from '../providers/httpUtil.ts'
import { ensureModelConfigured } from './worldAgent.ts'
import { ensurePricingSeeded, getPricing, estimateCostUsd, getUsdToKrwRate, checkBudget, reserveBudget, settleReservation } from './budget.ts'

export async function recommendStudio(db:DatabaseSync,draft:DraftDTO) {
  const fallback={intro:`${draft.name}. ${draft.background}`,places:['중앙홀','숙소','발전실','창고','외부'],resources:['식량','식수','연료'],occupations:['의사','기술자','연구원'],events:['발전기가 멈춘다'],truths:['시설 지하에 숨겨진 연구실이 존재한다'],endings:['DAY 4 도달']}
  if(config.worldDemoMode)return fallback
  if(config.production&&!config.providerLimitsConfirmed)throw new ProviderCallError('PROVIDER_LIMITS_UNCONFIRMED','provider limits required')
  ensureModelConfigured({provider:'openai',model:config.openaiModel});ensurePricingSeeded(db)
  const prompt=JSON.stringify({name:draft.name,genre:draft.genre,background:draft.background,climate:draft.studio?.climate})
  const system='WORLD 제작을 위한 한국어 제안만 생성한다. 확정된 사실이 아니다. JSON 객체 {intro:string,places:string[],resources:string[],occupations:string[],events:string[],truths:string[],endings:string[]}로 답한다. intro는 관전자용 소개, 각 배열은 3개 이하의 짧은 제안이다. 비밀을 intro에 노출하지 않는다. endings는 DAY N 도달 형식으로 제안한다.'
  const pricing=getPricing(db,'openai',config.openaiModel)!
  const reserveUsd=estimateCostUsd(pricing,Buffer.byteLength(prompt+system)+1000,1200),rate=getUsdToKrwRate(db),reserveKrw=reserveUsd*rate,b=checkBudget(db,reserveKrw)
  if(!b.allowed)throw new ProviderCallError('BUDGET_LIMIT','recommendation budget exhausted')
  reserveBudget(db,b.weekKey,reserveKrw,reserveUsd,b.monthKey)
  let cost=reserveUsd
  try{
    const res=await fetchWithLimits('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${config.openaiApiKey}`},body:JSON.stringify({model:config.openaiModel,messages:[{role:'system',content:system},{role:'user',content:prompt}],response_format:{type:'json_object'},max_tokens:1200})})
    if(!res.ok)throw new ProviderCallError('RECOMMENDATION_FAILED','provider failed')
    const result=await res.json() as {choices:Array<{message:{content:string}}>;usage?:{prompt_tokens:number;completion_tokens:number}}
    if(result.usage)cost=estimateCostUsd(pricing,result.usage.prompt_tokens,result.usage.completion_tokens)
    const parsed=JSON.parse(result.choices[0]?.message.content??'null') as typeof fallback
    if(!parsed||typeof parsed.intro!=='string'||Object.keys(fallback).filter(k=>k!=='intro').some(k=>!Array.isArray(parsed[k as 'places'])))throw new ProviderCallError('INVALID_RECOMMENDATION','invalid recommendation')
    for(const key of ['places','resources','occupations','events','truths','endings'] as const)parsed[key]=parsed[key].filter(v=>typeof v==='string').slice(0,5).map(v=>v.slice(0,500))
    parsed.intro=parsed.intro.slice(0,2000)
    return parsed
  }finally{settleReservation(db,b.weekKey,reserveKrw,reserveUsd,cost*rate,cost,'openai',b.monthKey)}
}
