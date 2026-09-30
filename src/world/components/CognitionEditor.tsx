import { useEffect, useState } from 'react'
import { DISPOSITION_LABELS, type Dispositions } from '../../../server/world/dispositions'
import { worldAdminApi } from '../api'

export function CognitionEditor({ paused }: { paused: boolean }) {
  const [actors,setActors]=useState<Awaited<ReturnType<typeof worldAdminApi.cognition>>['actors']>([])
  const [selected,setSelected]=useState(''), [values,setValues]=useState<Dispositions|null>(null)
  const [message,setMessage]=useState(''), [saving,setSaving]=useState(false)
  useEffect(()=>{let active=true;void worldAdminApi.cognition().then(r=>{if(active)setActors(r.actors)}).catch(()=>{if(active)setMessage('성향을 불러오지 못했습니다.')});return()=>{active=false}},[])
  const actor=actors.find(a=>a.id===selected)
  async function save(){if(!values)return;setSaving(true);try{await worldAdminApi.setDispositions(selected,values);setActors((await worldAdminApi.cognition()).actors);setMessage('저장했습니다. 이후 판단부터 적용됩니다.')}catch{setMessage('저장하지 못했습니다. 세계를 일시정지했는지 확인해 주세요.')}finally{setSaving(false)}}
  return <section className="admin-panel"><h2>캐릭터의 지속적인 성향</h2><p>0–10. 욕구와 별개로 판단에 영향을 줍니다. 실행 중인 행동은 바꾸지 않습니다. 수정하려면 세계를 일시정지하세요.</p>
    <label>캐릭터<select value={selected} onChange={e=>{setSelected(e.target.value);setValues(actors.find(a=>a.id===e.target.value)?.dispositions??null);setMessage('')}}><option value="">선택</option>{actors.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></label>
    {values&&<><fieldset disabled={!paused||saving}><div className="studio-grid">{Object.entries(DISPOSITION_LABELS).map(([key,label])=><label key={key}>{label}<input type="number" min={0} max={10} step={1} value={values[key as keyof Dispositions]} onChange={e=>setValues({...values,[key]:Number(e.target.value)})}/></label>)}</div><button onClick={()=>void save()}>성향 저장</button></fieldset><p>장기 목표: {actor?.motivations?.longTerm||'아직 정해지지 않음'}</p><p>누적 목표 기록 {actor?.motivations?.goals.length??0}개 · 실패와 결과는 다음 날에도 유지됩니다.</p></>}
    {message&&<p role="status">{message}</p>}
  </section>
}
