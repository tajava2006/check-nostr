import { useMemo, useState } from 'react'
import { nip19 } from 'nostr-tools'

type EncodeItem = {
  label: string
  value: string
}

function isHex(str: string): boolean {
  return /^[0-9a-f]+$/i.test(str)
}

function normalizeHex(input: string): string {
  const s = input.trim().toLowerCase().replace(/^0x/, '')
  return s
}

function toUint8(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return arr
}

function detectAndEncode(hexInput: string): EncodeItem[] | { error: string } {
  const raw = normalizeHex(hexInput)
  if (!raw) return { error: '값을 입력하세요.' }
  if (!isHex(raw)) return { error: '유효한 hex가 아닙니다.' }
  if (raw.length % 2 !== 0) return { error: 'hex 길이는 짝수여야 합니다.' }

  const bytes = toUint8(raw)
  const hex = raw

  const out: EncodeItem[] = []

  // 길이 기준 간단 판별
  // 32바이트: pubkey, secret key, event id 후보
  if (bytes.length === 32) {
    // npub (public key) - nostr-tools v2: hex string 입력
    try {
      const npub = nip19.npubEncode(hex)
      out.push({ label: 'npub (public key)', value: npub })
    } catch {
      /* ignore */
    }
    // nsec (secret key) - Uint8Array 입력 필요 (nostr-tools v2)
    try {
      const nsec = nip19.nsecEncode(bytes)
      out.push({ label: 'nsec (secret key)', value: nsec })
    } catch {
      /* ignore */
    }
    // note (event id) - hex string 입력
    try {
      const note = nip19.noteEncode(hex)
      out.push({ label: 'note (event id)', value: note })
    } catch {
      /* ignore */
    }
    // nevent (event object - 최소 id만 넣어 인코딩)
    try {
      const nevent = nip19.neventEncode({ id: hex } as { id: string; relays?: string[]; author?: string; kind?: number })
      out.push({ label: 'nevent (event, id only)', value: nevent })
    } catch {
      /* ignore */
    }
    // nprofile (profile object - 최소 pubkey만 넣어 인코딩)
    try {
      const nprofile = nip19.nprofileEncode({ pubkey: hex })
      out.push({ label: 'nprofile (profile, pubkey only)', value: nprofile })
    } catch {
      /* ignore */
    }
  }

  // 8/16/32/64 바이트 등 일반 바이트열 → 일반적인 목적의 bech32로 바꿀 일은 드묾.
  // 필요 시 커스텀 hrp 지원을 여기에 추가 가능.

  if (out.length === 0) {
    return {
      error:
        '알려진 포맷으로 인코딩할 수 없습니다. 일반적으로 32바이트 hex(pubkey, sk, event id)에 대해 npub/nsec/note/nevent/nprofile를 제공합니다.',
    }
  }
  return out
}

export default function HexToNip19() {
  const [input, setInput] = useState('')

  const result = useMemo(() => {
    if (!input) return null
    return detectAndEncode(input)
  }, [input])

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', padding: '0 16px' }}>
      <h2 style={{ marginTop: 0 }}>Hex → NIP-19</h2>
      <p style={{ color: '#666' }}>
        32바이트 hex를 넣으면 가능한 NIP-19 포맷(npub/nsec/note/nevent/nprofile)을 표시합니다.
      </p>

      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="예) 32바이트 hex (공개키/비밀키/event id)"
        spellCheck={false}
        style={{
          width: '100%',
          padding: '12px 14px',
          fontSize: 16,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          border: '1px solid #ccc',
          borderRadius: 8,
          outline: 'none',
        }}
      />

      <div style={{ marginTop: 20 }}>
        {!input ? (
          <div style={{ color: '#888' }}>값을 입력하세요.</div>
        ) : result == null ? null : Array.isArray(result) ? (
          <div
            style={{
              display: 'grid',
              gap: 8,
            }}
          >
            {result.map((r) => (
              <div key={r.label}>
                <div style={{ marginBottom: 4, color: '#444' }}>{r.label}</div>
                <div
                  style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    background: '#f7f7f7',
                    padding: '12px',
                    borderRadius: 8,
                    border: '1px solid #eee',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}
                >
                  {r.value}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: '#c33' }}>오류: {result.error}</div>
        )}
      </div>
    </div>
  )
}
