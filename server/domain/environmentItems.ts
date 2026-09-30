import type {StudioItem} from './studioConfig.ts'
// Explicit creator action, never automatic retroactive population of a live world.
export function suggestEnvironmentItems(places:Array<{id:string;name:string;description:string;type:string}>,existing:StudioItem[]):StudioItem[]{
 const result:StudioItem[]=[]
 for(const p of places){
  if(!['자연','실외','위험 지역'].includes(p.type))continue
  const text=p.name+' '+p.description
  const options=[{match:/바위|자갈|암석|rock|pebble/i,name:'돌',material:'stone' as const,area:'SHORE',power:1}, {match:/숲|나무|수풀|forest|woodland/i,name:'나뭇가지',material:'wood' as const,area:'FOREST',power:1},{match:/모래|백사장|sand/i,name:'모래',material:'sand' as const,area:'SHORE',power:0}]
  for(const o of options){const id=`environment-${p.id}-${o.material}`;if(!o.match.test(text)||existing.some(i=>i.id===id||i.holderId===p.id&&i.name===o.name))continue
   result.push({id,name:o.name,kind:'tool',quantity:3,holderKind:'place',holderId:p.id,localArea:o.area,physical:{material:o.material,portable:true,attackPower:o.power,cover:0}})
  }
 }
 return result
}
