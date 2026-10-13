// Keeping a walk moving between two snapshots.
//
// The server reports a position once a tick. A trip, though, is a path the engine has already
// planned — every waypoint carries the world minute it is reached — and that whole plan is in the
// payload. So a map does not have to wait for the next snapshot to move anyone: it can read the
// clock forward and draw the walker where the engine is going to say they are.
//
// Everything here is arithmetic on data already sent. It costs the server nothing, and it is
// bounded: a viewer may never run further than the one tick of lookahead the server allowed, so a
// stalled or paused world freezes the walk instead of strolling people off the island.
type GeoPoint = import('../../server/world/geo/geoTypes').GeoPoint
type GeoTravel = import('../../server/world/geo/geoTypes').GeoTravel

export interface WorldPace { at: string; minutePerMs: number; until: number }

// The same arithmetic as the engine's own positionAt (server/world/geo/movement.ts), minus its
// rounding to whole metres — a marker should slide, not step. A test holds the two together.
export function positionOnPath(travel: GeoTravel, minute: number): GeoPoint {
  if (minute <= travel.startMinute) return { ...travel.from }
  if (minute >= travel.arriveMinute) return { ...travel.to }
  for (let i = 1; i < travel.path.length; i++) {
    const a = travel.path[i - 1], b = travel.path[i]
    if (minute <= b.minute) {
      const f = b.minute === a.minute ? 1 : (minute - a.minute) / (b.minute - a.minute)
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
    }
  }
  return { ...travel.to }
}

// The world minute a viewer is entitled to believe in right now: what the snapshot reported, plus
// however much world time has passed since it was taken, and never past the lookahead the server
// granted. Without a pace — an old server, a paused world, a snapshot that never carried one —
// this is just the reported minute, and the map behaves exactly as it did before.
export function liveMinute(reportedMinute: number, pace: WorldPace | undefined, now: number): number {
  if (!pace || !(pace.minutePerMs > 0)) return reportedMinute
  const since = now - Date.parse(pace.at)
  if (!Number.isFinite(since) || since <= 0) return reportedMinute
  return Math.min(pace.until, reportedMinute + since * pace.minutePerMs)
}

// Whether there is anything to animate. A snapshot in which nobody is mid-trip needs no frame
// loop at all, and that is the usual case — the map should idle, not burn a core.
export function anyoneWalking(travels: Array<GeoTravel | undefined>, minute: number): boolean {
  return travels.some(travel => Boolean(travel) && minute < travel!.arriveMinute)
}
