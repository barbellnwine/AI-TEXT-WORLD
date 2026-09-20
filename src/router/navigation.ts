// Minimal History-API navigation helper — no router library needed for a handful of top-level
// routes. pushState updates the URL; dispatching a real 'popstate' event lets Router.tsx (and
// anything else listening for it) react the same way it would to a browser back/forward action.
export function navigate(to: string): void {
  const current = window.location.pathname + window.location.search + window.location.hash
  if (to === current) return
  window.history.pushState(null, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
