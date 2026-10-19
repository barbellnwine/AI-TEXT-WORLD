import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
mkdirSync('public/fonts', { recursive: true })
// Drop the previous family's subset files so retired weights do not linger in public/.
for (const name of readdirSync('public/fonts')) if (/^font-\d+\.(woff2|ttf)$/.test(name)) rmSync(`public/fonts/${name}`)
const url = 'https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,500;6..96,600;6..96,700&family=IBM+Plex+Mono:wght@400;500&family=Noto+Serif+KR:wght@200..900&display=swap'
const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' } })
if (!response.ok) throw new Error('Font stylesheet unavailable')
let css = await response.text()
const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]))]
for (let offset = 0; offset < urls.length; offset += 8) {
  await Promise.all(urls.slice(offset, offset+8).map(async (remote, i) => {
    const response = await fetch(remote)
    if (!response.ok) throw new Error('Font download failed')
    const name = `font-${offset+i}.${remote.includes('.woff2') ? 'woff2' : 'ttf'}`
    writeFileSync(`public/fonts/${name}`, Buffer.from(await response.arrayBuffer()))
    css = css.replaceAll(remote, `/fonts/${name}`)
  }))
}
writeFileSync('public/fonts/fonts.css', css)
// Replace only the first import line; the URL contains semicolons.
const original = readFileSync('src/styles.css', 'utf8')
writeFileSync('src/styles.css', original.replace(/^@import[^\n]+/, "@import url('/fonts/fonts.css');"))
console.log(`Stored ${urls.length} font files locally.`)
