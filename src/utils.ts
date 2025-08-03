
export function normalizeHex(input: string): string {
  const s = input.trim().toLowerCase().replace(/^0x/, '')
  return s
}

export function toUint8(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return arr
}

export function isHex32(s: string): boolean {
  const v = s.trim().toLowerCase().replace(/^0x/, '')
  return /^[0-9a-f]{64}$/.test(v)
}

export function normalizeRelayUrl(url: string): string {
  let u = url.trim()
  if (!u) return ''
  // Normalize relay URL (ensure scheme and remove trailing slashes)
  if (!/^wss?:\/\//i.test(u)) u = `wss://${u}`
  try {
    const parsed = new URL(u)
    // Remove trailing slash and normalize host
    parsed.pathname = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.protocol}//${parsed.host}${parsed.pathname || ''}`
  } catch {
    // Fallback if URL parsing fails
    return u.replace(/\/+$/, '')
  }
}

export function uniq(arr: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of arr) {
    const nx = normalizeRelayUrl(x)
    if (!nx) continue
    if (!seen.has(nx)) {
      seen.add(nx)
      out.push(nx)
    }
  }
  return out
}

