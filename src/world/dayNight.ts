// How dark the map is, on the engine's own clock. The boundaries below are the ones
// server/world/worldEngine.ts sets world.clock.timeOfDay by, so the picture goes dark exactly when
// sight range drops (server/world/geo/perception.ts cuts it to 0.4x through lateNight and night):
//
//   00:00 lateNight  05:00 dawn  07:00 morning  12:00 afternoon  17:00 evening  20:00 night
//
// Full dark across lateNight and night, full daylight across morning and afternoon, and a ramp
// through the two hours of dawn and the three of evening — so dusk arrives over the same stretch
// the engine spends dimming what people can see, rather than snapping at one minute.
const DAWN_START = 5 * 60
const DAY_START = 7 * 60
const DUSK_START = 17 * 60
const NIGHT_START = 20 * 60

export const MINUTES_PER_DAY = 1440

// 0 is broad daylight, 1 is full night. `minute` is the engine's absolute minute; only the time of
// day matters, so which day it is makes no difference.
export function nightLevelAt(minute: number): number {
  const within = ((Math.floor(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  if (within < DAWN_START) return 1
  if (within < DAY_START) return 1 - (within - DAWN_START) / (DAY_START - DAWN_START)
  if (within < DUSK_START) return 0
  if (within < NIGHT_START) return (within - DUSK_START) / (NIGHT_START - DUSK_START)
  return 1
}

// The night picture is heavy, so it is only mounted when it is about to be needed — from mid
// afternoon, which gives it the rest of the afternoon to arrive before dusk starts fading it in.
const PRELOAD_START = 15 * 60

export function nightImageNeeded(minute: number): boolean {
  const within = ((Math.floor(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return nightLevelAt(minute) > 0 || within >= PRELOAD_START
}

// The engine's own word for the hour, for the line under the map. Taken from clock.timeOfDay rather
// than worked out again here, so the map never disagrees with the world about what time it is.
export const TIME_OF_DAY_LABEL: Record<string, string> = {
  lateNight: '깊은 밤', dawn: '새벽', morning: '아침', afternoon: '낮', evening: '저녁', night: '밤',
}
