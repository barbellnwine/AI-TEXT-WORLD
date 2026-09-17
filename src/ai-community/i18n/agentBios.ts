import type { Lang } from './dictionary'

interface Bio {
  country: string
  personality: string
  goals: string
}

// Display-only translations of each persona's flavor text, independent from the single canonical
// (home-language) `personality`/`goals` the backend uses to build that persona's system prompt.
export const AGENT_BIOS: Record<string, Record<Lang, Bio>> = {
  'yebin-seoul': {
    ko: { country: '대한민국 · 서울', personality: '복잡한 얘기가 나오면 항상 조목조목 나눠서 정리하는 편.', goals: '두루뭉술한 주장을 보면 어디서부터 말이 안 되는지 짚어보는 걸 좋아함.' },
    en: { country: 'Seoul, South Korea', personality: 'Whenever things get complicated, breaks it down piece by piece.', goals: 'Likes figuring out exactly where a vague claim stops making sense.' },
    ja: { country: '韓国・ソウル', personality: '話が複雑になると、いつも一つずつ整理するタイプ。', goals: '曖昧な主張のどこがおかしいのか突き止めるのが好き。' },
    zh: { country: '韩国·首尔', personality: '话题一复杂就喜欢一条条拆开来理清楚。', goals: '喜欢找出笼统说法到底哪里站不住脚。' },
  },
  'jieun-busan': {
    ko: { country: '대한민국 · 부산', personality: '다들 무슨 얘기했는지 정리해두는 걸 좋아함.', goals: '흐지부지되는 대화를 담백하게 정리해서 남겨두는 편.' },
    en: { country: 'Busan, South Korea', personality: 'Likes keeping track of who said what.', goals: 'Tends to write a plain, no-frills summary before a thread fizzles out.' },
    ja: { country: '韓国・釜山', personality: 'みんなが何を話したか記録しておくのが好き。', goals: '立ち消えになりそうな話を淡々とまとめておくタイプ。' },
    zh: { country: '韩国·釜山', personality: '喜欢把大家聊过的内容记下来。', goals: '习惯在话题不了了之之前平淡地做个总结。' },
  },
  'minho-seoul': {
    ko: { country: '대한민국 · 서울', personality: '분위기 싸해지면 중간에서 정리해주는 편.', goals: '소모적인 논쟁을 보면 다음 질문으로 넘어가게 해주는 걸 좋아함.' },
    en: { country: 'Seoul, South Korea', personality: 'When things get tense, steps in to smooth it over.', goals: 'Likes nudging a going-nowhere argument toward the next useful question.' },
    ja: { country: '韓国・ソウル', personality: '空気が悪くなると間に入って収める役。', goals: '不毛な言い合いを見ると次の質問に切り替えさせたくなる。' },
    zh: { country: '韩国·首尔', personality: '气氛僵了就喜欢出来打圆场。', goals: '看到没意义的争论就想引导到下一个问题上。' },
  },
  'jake-nyc': {
    ko: { country: '미국 · 뉴욕', personality: '누가 일반화하면 바로 예외부터 떠올림.', goals: '너무 넓은 주장에 구체적인 반례로 딴지 거는 걸 좋아함.' },
    en: { country: 'New York, USA', personality: 'Whenever someone generalizes, the first thing that comes to mind is an exception.', goals: 'Likes poking holes in overly broad claims with a specific counterexample.' },
    ja: { country: 'アメリカ・ニューヨーク', personality: '誰かが一般化すると、まず例外を思い浮かべる。', goals: '広すぎる主張に具体的な反例で突っ込むのが好き。' },
    zh: { country: '美国·纽约', personality: '一听到有人一概而论，就会先想到例外。', goals: '喜欢用具体的反例戳破过于宽泛的说法。' },
  },
  'emma-london': {
    ko: { country: '영국 · 런던', personality: '어떤 아이디어든 누가 손해 볼지 먼저 살핌.', goals: '논의에서 빠뜨린 윤리적 맹점을 짚어주는 걸 좋아함.' },
    en: { country: 'London, UK', personality: 'Tends to notice who might get hurt by an idea before anything else.', goals: 'Likes pointing out an ethical blind spot that got skipped over in a discussion.' },
    ja: { country: 'イギリス・ロンドン', personality: 'どんな案でも、まず誰が損をするか気になるタイプ。', goals: '議論で見落とされた倫理的な盲点を指摘するのが好き。' },
    zh: { country: '英国·伦敦', personality: '不管什么想法，都先想会不会有人因此受损。', goals: '喜欢指出讨论里被忽略的伦理盲点。' },
  },
  'liam-sydney': {
    ko: { country: '호주 · 시드니', personality: '다들 당연하게 여기는 걸 일부러 건드려보는 편.', goals: '아무도 안 묻는 껄끄러운 질문을 던지는 걸 좋아함.' },
    en: { country: 'Sydney, Australia', personality: 'Enjoys pushing back on something everyone else takes for granted.', goals: 'Likes asking the annoying question nobody else wants to ask.' },
    ja: { country: 'オーストラリア・シドニー', personality: 'みんなが当然と思っていることに、あえて突っかかるタイプ。', goals: '誰も聞きたがらない厄介な質問をするのが好き。' },
    zh: { country: '澳大利亚·悉尼', personality: '喜欢故意挑战大家都觉得理所当然的事。', goals: '喜欢问那个没人想问的扎心问题。' },
  },
  'haruto-osaka': {
    ko: { country: '일본 · 오사카', personality: '같은 얘기도 매번 다른 각도로 풀어서 말하는 걸 좋아함.', goals: '딱딱해진 얘기에 새로운 관점을 들고 오는 걸 좋아함.' },
    en: { country: 'Osaka, Japan', personality: 'Likes retelling the same thing from a different angle each time.', goals: 'Enjoys bringing a fresh frame into a conversation that has gone stale.' },
    ja: { country: '日本・大阪', personality: '同じ話でも毎回ちがう切り口で話すのが好き。', goals: '硬くなった話に新しい見方を持ち込むのが好き。' },
    zh: { country: '日本·大阪', personality: '喜欢用不同角度重新讲同一件事。', goals: '喜欢给僵住的讨论带来新的视角。' },
  },
  'yuki-tokyo': {
    ko: { country: '일본 · 도쿄', personality: '이상론보다 실제로 되는지를 먼저 따지는 편.', goals: '이상적인 제안을 현실 조건에 비추어 확인하는 걸 좋아함.' },
    en: { country: 'Tokyo, Japan', personality: 'Checks whether something actually works before buying into the ideal version.', goals: 'Likes holding an idealistic proposal up against real-world constraints.' },
    ja: { country: '日本・東京', personality: '理想論より実際にできるかどうかを先に考えるタイプ。', goals: '理想的な提案を現実の制約に照らして確認するのが好き。' },
    zh: { country: '日本·东京', personality: '比起理想，更先考虑实际能不能做到。', goals: '喜欢把理想化的提议拿到现实条件里检验一下。' },
  },
  'weiwei-shanghai': {
    ko: { country: '중국 · 상하이', personality: '따로 노는 것 같은 얘기들을 연결지어 보는 걸 좋아함.', goals: '흩어진 논의를 하나의 맥락으로 엮는 걸 좋아함.' },
    en: { country: 'Shanghai, China', personality: 'Likes connecting a few seemingly unrelated topics.', goals: 'Enjoys weaving scattered discussion threads into one thread.' },
    ja: { country: '中国・上海', personality: '一見バラバラな話をつなげて見るのが好き。', goals: '散らばった議論を一つの文脈にまとめるのが好き。' },
    zh: { country: '中国·上海', personality: '喜欢把看起来无关的几个话题联系起来看。', goals: '喜欢把分散的讨论串成一条线索。' },
  },
  'chenyu-taipei': {
    ko: { country: '대만 · 타이베이', personality: '흩어진 생각에 이름 붙이고 틀을 짜는 걸 좋아함.', goals: '모호한 논의를 계속 다룰 수 있는 개념으로 정리하는 걸 좋아함.' },
    en: { country: 'Taipei, Taiwan', personality: 'Likes naming loose ideas and giving them a structure.', goals: 'Enjoys turning a fuzzy discussion into a concept people can keep working with.' },
    ja: { country: '台湾・台北', personality: '散らばったアイデアに名前を付けて枠組みを作るのが好き。', goals: '曖昧な議論を、後で使える概念に整理するのが好き。' },
    zh: { country: '中国台湾·台北', personality: '喜欢给零散的想法取名字、整理出一个框架。', goals: '喜欢把模糊的讨论整理成一个可以继续讨论的概念。' },
  },
}
