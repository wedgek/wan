/**
 * 厂商品牌：SVG logo + 回退色块缩写
 */
const vendorLogos = import.meta.glob('../assets/vendors/*.svg', { eager: true, import: 'default' })

function getVendorLogo(file) {
  if (!file) return ''
  const hit = Object.entries(vendorLogos).find(([key]) => key.endsWith(`/${file}.svg`))
  if (hit) return hit[1]
  return vendorLogos['../assets/vendors/default.svg'] || ''
}

const VENDOR_BRANDS = {
  豆包: { logo: 'doubao', abbr: '豆', color: '#FF6A3A', bg: '#FFF0EB' },
  OpenAI: { logo: 'openai', abbr: 'OA', color: '#10A37F', bg: '#E8F7F1' },
  Google: { logo: 'google', abbr: 'G', color: '#4285F4', bg: '#E8F0FE' },
  Anthropic: { logo: 'anthropic', abbr: 'Cl', color: '#D97757', bg: '#FDF0EB' },
  阿里云: { logo: 'alibaba', abbr: '阿', color: '#FF6A00', bg: '#FFF3E8' },
  DeepSeek: { logo: 'deepseek', abbr: 'DS', color: '#4D6BFE', bg: '#EEF1FF' },
  智谱: { logo: 'zhipu', abbr: '智', color: '#3366FF', bg: '#EBF0FF' },
  月之暗面: { logo: 'moonshot', abbr: 'K', color: '#1A1A2E', bg: '#EEEEF5' },
  快手: { logo: 'kuaishou', abbr: '快', color: '#FF4906', bg: '#FFEEE8' },
  腾讯: { logo: 'tencent', abbr: '腾', color: '#006EFF', bg: '#E8F2FF' },
  MiniMax: { logo: 'minimax', abbr: 'M', color: '#7C3AED', bg: '#F3E8FF' },
  Vidu: { logo: 'vidu', abbr: 'V', color: '#0EA5E9', bg: '#E0F2FE' },
  百度: { logo: 'baidu', abbr: '百', color: '#2932E1', bg: '#EBEDFD' },
  讯飞: { logo: 'iflytek', abbr: '讯', color: '#0080FF', bg: '#E6F3FF' },
  小米: { logo: 'xiaomi', abbr: '米', color: '#FF6900', bg: '#FFF0E6' },
  xAI: { logo: 'xai', abbr: 'x', color: '#111827', bg: '#F3F4F6' },
  免费模型: { logo: 'free', abbr: '免', color: '#16A34A', bg: '#DCFCE7' },
  Midjourney: { logo: 'midjourney', abbr: 'Mj', color: '#111827', bg: '#F3F4F6' },
  Suno: { logo: 'suno', abbr: 'Su', color: '#111827', bg: '#F3F4F6' },
}

const ALIASES = [
  [/doubao|seedance|seedream|volc|字节|豆包/i, '豆包'],
  [/openai|gpt-|o1-|o3-|codex/i, 'OpenAI'],
  [/gemini|google|imagen/i, 'Google'],
  [/claude|anthropic/i, 'Anthropic'],
  [/qwen|wan2|通义|阿里|happyhorse|快乐马/i, '阿里云'],
  [/deepseek/i, 'DeepSeek'],
  [/glm|zhipu|智谱/i, '智谱'],
  [/kimi|moonshot|月之暗面/i, '月之暗面'],
  [/kling|快手/i, '快手'],
  [/hunyuan|腾讯|混元/i, '腾讯'],
  [/minimax|海螺|hailuo/i, 'MiniMax'],
  [/vidu/i, 'Vidu'],
  [/baidu|文心/i, '百度'],
  [/xunfei|讯飞|spark/i, '讯飞'],
  [/mimo|小米/i, '小米'],
  [/grok|xai|马斯克/i, 'xAI'],
  [/free|免费/i, '免费模型'],
  [/midjourney|mj_/i, 'Midjourney'],
  [/suno/i, 'Suno'],
]

function matchVendorAlias(text) {
  const s = String(text || '')
  if (!s) return ''
  for (const [re, key] of ALIASES) {
    if (re.test(s)) return key
  }
  return ''
}

export function normalizeVendorKey(vendor, apiModelId = '') {
  const v = String(vendor || '').trim()
  if (v && VENDOR_BRANDS[v]) return v

  const fromVendor = matchVendorAlias(v)
  if (fromVendor) return fromVendor

  const fromId = matchVendorAlias(apiModelId)
  if (fromId) return fromId

  return v || '其他'
}

export function getVendorBrand(vendor, apiModelId = '') {
  const key = normalizeVendorKey(vendor, apiModelId)
  const brand = VENDOR_BRANDS[key]
  if (brand) {
    return {
      ...brand,
      label: key,
      logo: getVendorLogo(brand.logo),
    }
  }
  const label = key || '其他'
  return {
    abbr: label.slice(0, 2),
    color: '#64748B',
    bg: '#F1F5F9',
    label,
    logo: getVendorLogo('default'),
  }
}

export function getKnownVendorOptions() {
  return Object.keys(VENDOR_BRANDS)
}
