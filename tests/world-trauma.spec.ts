import {test,expect} from '@playwright/test'

test('character injury panel shows persistent functional limits on mobile and desktop',async({page,request})=>{
 await page.addInitScript(()=>localStorage.setItem('ai_world_locale','ko-KR'))
 const response=await request.get('/api/world/agents'),data=await response.json()
 const agent=(data.items??data.agents)[0]
 await page.route(`**/api/world/agents/${agent.id}`,async route=>{
  const response=await route.fetch(),body=await response.json()
  body.agent.trauma={version:1,lastMinute:30,bloodLoss:.02,pain:4,functions:{vision:.4,mobility:.6,dexterity:0,attention:0},injuries:[{id:'fixture',part:'HEAD',type:'laceration',site:'scalp',severity:2,bleeding:1.5,pain:4,healingHours:12,effects:[],sourceEventId:'fixture-event',onset:0,treatedAt:null,healed:false}]}
  await route.fulfill({json:body})
 })
 await page.goto(`/characters/${agent.id}`)
 await expect(page.getByText('시야 제약',{exact:true})).toBeVisible()
 await expect(page.getByText('40%',{exact:true})).toBeVisible()
 await expect(page.getByText('60%',{exact:true})).toBeVisible()
 await expect(page.getByText('처치하지 않은 상처가 있습니다.',{exact:true})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
})
