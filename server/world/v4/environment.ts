import type { Place } from '../../domain/worldTypes.ts'

// Natural materials a place plausibly offers, inferred from its name/description. These are
// hints for the character and the GM; the GM still judges plausibility from the full text.
// Nothing here is a hard fact until the GM turns it into a created object.
const AFFORDANCES: Array<[RegExp, string[]]> = [
  [/숲|나무|수풀|덤불|정글|forest|wood/i, ['나무', '곧은 가지', '덩굴', '마른 잎', '나무껍질']],
  [/해변|바닷가|해안|모래사장|갯벌|beach|shore/i, ['모래', '조개', '해초', '떠밀려 온 나무', '바닷물', '바다 물고기']],
  [/바다|만(?:$|\s)|파도|sea|ocean/i, ['바닷물', '바다 물고기', '해초']],
  [/바위|절벽|고지대|협곡|돌|암벽|언덕|rock|cliff|gorge/i, ['돌', '날카로운 돌조각', '바위 틈', '넓은 시야']],
  [/동굴|굴|cave/i, ['어둠', '바위 틈', '서늘한 공기', '돌']],
  [/샘|개울|강|호수|계곡|폭포|spring|river|lake|stream/i, ['담수', '민물 물고기', '진흙', '매끈한 돌']],
  [/야영지|캠프|camp/i, ['버려진 천 조각', '끈', '재가 남은 모닥불 자리']],
  [/초원|들판|평원|풀밭|field|meadow/i, ['마른 풀', '작은 동물의 흔적']],
]

export function environmentHints(place: Pick<Place, 'name' | 'description'>): string[] {
  const text = `${place.name} ${place.description}`
  return [...new Set(AFFORDANCES.filter(([pattern]) => pattern.test(text)).flatMap(([, items]) => items))]
}
