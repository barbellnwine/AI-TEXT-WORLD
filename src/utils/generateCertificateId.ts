export function generateCertificateId(date = new Date()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  const suffix = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
  return 'AI-AMNESTY-' + date.getFullYear() + '-' + suffix
}