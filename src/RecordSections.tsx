import type { RecordFile } from './types'
// Each record keeps its own section numbering, so the mirrored fields are declared per record
// rather than assumed. PROTOCOL is the section shown as 대응 지침; EPISODES are the section
// bodies that the 사건 기록 tab reproduces, in episode order.
const PROTOCOL: Record<string,string> = { 'TA-021': '04', 'TA-013': '08', 'TA-059': '10', 'TA-001': '07', 'TA-060': '07' }
const EPISODES: Record<string,string[]> = { 'TA-021': ['06','07'], 'TA-013': ['03','04','05','06'], 'TA-059': ['03','08'], 'TA-001': ['03'], 'TA-060': ['02','03','04'] }
export default function RecordSections({record,change}:{record:RecordFile;change:(record:RecordFile)=>void}) {
  if (!record.sections?.length) return null
  const update=(index:number,key:'title'|'body',value:string)=>{
    const sections=record.sections!.map((s,i)=>i===index?{...s,[key]:value}:s)
    const edited=sections[index]
    let next={...record,sections}
    if(key!=='body'){change(next);return}
    if(edited.number==='01')next={...next,description:value}
    if(edited.number===(PROTOCOL[record.id]??'04'))next={...next,protocol:value}
    const episode=(EPISODES[record.id]??[]).indexOf(edited.number)
    if(episode>=0)next={...next,episodes:record.episodes?.map((e,i)=>i===episode?{...e,body:value}:e)}
    change(next)
  }
  return <><section className="editor-section"><div className="editor-heading"><div><span className="eyebrow">ARCHIVE METADATA</span><h2>원본 기록 정보</h2></div></div><div className="form-grid">{([['riskLabel','위험 등급 표기'],['phenomenon','현상 유형'],['discovered','최초 발견'],['region','주요 출현 지역'],['recordStatus','기록 상태']] as const).map(([key,label])=><label key={key}>{label}<input value={record[key]||''} onChange={e=>change({...record,[key]:e.target.value})}/></label>)}</div></section><section className="editor-section"><div className="editor-heading"><div><span className="eyebrow">COMPLETE ENTITY RECORD</span><h2>개체 기록서 본문</h2></div></div><p className="editor-note">원본의 섹션 순서를 보존합니다. 개요·대응 지침과 사건으로 연재되는 섹션의 본문은 관련 표시에도 함께 반영됩니다.</p>{record.sections.map((s,i)=><div className="nested-record" key={s.number}><div className="nested-heading"><span className="mono">SECTION {s.number}</span></div><div className="form-grid"><label className="wide">섹션 제목<input required value={s.title} onChange={e=>update(i,'title',e.target.value)}/></label><label className="wide">본문 · Markdown 지원<textarea required rows={12} value={s.body} onChange={e=>update(i,'body',e.target.value)}/></label></div></div>)}</section></>
}
