/**
 * 从品牌源拉取厂商 SVG logo → src/assets/vendors/
 *
 * 优先级：本地多色矢量 > Lobe Icons **-color** 彩色版 > Lobe mono + 品牌色 > Simple Icons CDN > 字标回退
 * 运行：node scripts/fetch-vendor-logos.cjs
 */
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'src', 'assets', 'vendors')
const LOBE_BASE = 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons'
const SI_BASE = 'https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons'

/** 文件名 → Lobe Icons slug（https://lobehub.com/icons） */
const LOBE_MAP = {
  anthropic: 'anthropic',
  alibaba: 'alibabacloud',
  deepseek: 'deepseek',
  baidu: 'baidu',
  xai: 'xai',
  suno: 'suno',
  doubao: 'doubao',
  kuaishou: 'kling',
  minimax: 'minimax',
  moonshot: 'moonshot',
  coze: 'coze',
  midjourney: 'midjourney',
  tencent: 'tencent',
  zhipu: 'zhipu',
  vidu: 'vidu',
  iflytek: 'iflytekcloud',
}

/** 文件名 → Simple Icons slug（Lobe 无覆盖时） */
const SI_MAP = {
  xiaomi: 'xiaomi',
}

/** Google 四色 G */
const GOOGLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`

/** OpenAI knot 路径 */
const OPENAI_SVG = `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>OpenAI</title><path fill="#000000" d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.182a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .511 4.91 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.989 5.989 0 0 0 3.998-2.9 6.056 6.056 0 0 0-.747-7.073zm-9.022 12.608a4.476 4.476 0 0 1-2.876-1.04l.142-.08 4.778-2.758a.795.795 0 0 0 .393-.681v-6.737l2.02 1.169a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.495 4.494zm-9.661-4.125a4.471 4.471 0 0 1-.535-3.014l.142.085 4.783 2.758a.771.771 0 0 0 .781 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L6.74 19.95a4.499 4.499 0 0 1-6.141-1.646zM2.341 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.814 3.354-2.02 1.169a.076.076 0 0 1-.071 0l-4.83-2.787A4.504 4.504 0 0 1 2.341 7.872zm16.596 3.856-5.833-3.387 2.006-1.164a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.104v-5.677a.79.79 0 0 0-.398-.667zm2.011-3.023-.142-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.499 4.499 0 0 1 6.68 4.66zM8.307 12.863l-2.02-1.164a.08.08 0 0 1-.038-.057V6.074a4.499 4.499 0 0 1 7.376-3.454l-.142.08L8.704 5.459a.795.795 0 0 0-.393.681z"/></svg>`

const LOCAL = {
  google: GOOGLE_SVG,
  openai: OPENAI_SVG,
}

/** 无 -color 版本时，把 currentColor 替换为品牌色（与 vendorBrand.js 一致） */
const BRAND_COLORS = {
  anthropic: '#D97757',
  alibaba: '#FF6A00',
  deepseek: '#4D6BFE',
  baidu: '#2932E1',
  xai: '#111827',
  suno: '#111827',
  doubao: '#FF6A3A',
  kuaishou: '#FF4906',
  minimax: '#7C3AED',
  moonshot: '#1A1A2E',
  coze: '#4D53E8',
  midjourney: '#111827',
  tencent: '#006EFF',
  zhipu: '#3366FF',
  vidu: '#0EA5E9',
  iflytek: '#0080FF',
  xiaomi: '#FF6900',
}

function applyBrandColor(svg, hex) {
  if (!hex || !svg.includes('currentColor')) return svg
  return svg.replace(/fill="currentColor"/g, `fill="${hex}"`)
}

function write(file, content) {
  fs.writeFileSync(path.join(OUT, `${file}.svg`), content.trim() + '\n', 'utf8')
  console.log(`  ✓ ${file}.svg`)
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'wan-ai-vendor-logos/1.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  if (!text.includes('<svg')) throw new Error('invalid svg')
  return text.trim()
}

async function fetchLobe(file, slug) {
  const hex = BRAND_COLORS[file]
  try {
    const colorSvg = await fetchText(`${LOBE_BASE}/${slug}-color.svg`)
    if (!colorSvg.includes('currentColor')) return colorSvg
  } catch (_) {
    /* 无 -color 版本，继续拉 mono */
  }
  const mono = await fetchText(`${LOBE_BASE}/${slug}.svg`)
  return applyBrandColor(mono, hex)
}

async function fetchSi(file, slug) {
  const svg = await fetchText(`${SI_BASE}/${slug}.svg`)
  return applyBrandColor(svg, BRAND_COLORS[file])
}

function lettermark(file, char, bg, fg = '#fff') {
  write(
    file,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="${bg}"/><text x="12" y="16" text-anchor="middle" fill="${fg}" font-size="12" font-weight="700" font-family="system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">${char}</text></svg>`,
  )
}

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })
  console.log('Fetching vendor logos ->', OUT)

  for (const [file, svg] of Object.entries(LOCAL)) {
    write(file, svg)
  }

  for (const [file, slug] of Object.entries(LOBE_MAP)) {
    try {
      write(file, await fetchLobe(file, slug))
    } catch (e) {
      console.warn(`  ! Lobe ${file} (${slug}): ${e.message}`)
    }
  }

  for (const [file, slug] of Object.entries(SI_MAP)) {
    try {
      write(file, await fetchSi(file, slug))
    } catch (e) {
      console.warn(`  ! SI ${file} (${slug}): ${e.message}`)
    }
  }

  lettermark('free', '免', '#16A34A')
  lettermark('default', '?', '#64748B')

  console.log('Done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
