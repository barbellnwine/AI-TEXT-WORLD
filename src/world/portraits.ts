// A character's picture. An explicit choice wins: avatarId naming one of the portraits below is
// taken at its word. Failing that the picture is chosen from what the person does for a living,
// which the engine already writes at the head of every shortBio ("응급실 간호사 · 침착·계산적 …"),
// so a season built before any of this still shows faces. A world whose people do something these
// pictures cannot stand in for simply gets none, and keeps the lettered avatar it has always had.

export const PORTRAITS = ['medic', 'hunter', 'salesman', 'gangster', 'soldier'] as const
export type Portrait = typeof PORTRAITS[number]

// First match wins, so the more particular trades are listed before the broader ones.
const BY_TRADE: Array<[RegExp, Portrait]> = [
  [/간호|의사|의료|응급|구급|약사|수의사|위생병|군의/, 'medic'],
  [/조직폭력|조폭|야쿠자|건달|깡패|조직원|해결사/, 'gangster'],
  [/군인|부사관|장교|특전|해병|용병|경찰|경호|보안/, 'soldier'],
  [/사냥|엽사|가이드|레인저|산악|밀렵|어부|농부|벌목|측량/, 'hunter'],
  [/영업|세일즈|사업|회사원|컨설턴트|변호사|중개|기획|금융|보험/, 'salesman'],
]

// The occupation is the head of the bio, before the first separator. Matching only that keeps a
// stray word elsewhere in the sentence from deciding what someone looks like.
function trade(shortBio: string | undefined): string {
  return (shortBio ?? '').split(/[·|,]/)[0].slice(0, 60)
}

export function portraitNameFor(agent: { avatarId?: string; shortBio?: string }): Portrait | null {
  if (PORTRAITS.includes(agent.avatarId as Portrait)) return agent.avatarId as Portrait
  return BY_TRADE.find(([pattern]) => pattern.test(trade(agent.shortBio)))?.[1] ?? null
}

export function portraitFor(agent: { avatarId?: string; shortBio?: string }): string | null {
  const name = portraitNameFor(agent)
  return name ? `/characters/${name}.webp` : null
}
