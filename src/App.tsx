import { useMemo, useState } from 'react'
import './App.css'
import { nip19 } from 'nostr-tools'

type DecodeResult =
  | { ok: true; type: string; hex: string }
  | { ok: false; error: string }

function decodeNip19(input: string): DecodeResult {
  try {
    const trimmed = input.trim()
    if (!trimmed) return { ok: false, error: '값을 입력하세요.' }

    const { type, data } = nip19.decode(trimmed)

    // 단순 타입은 바로 hex 추출
    // npub/nsec/note: data가 hex 문자열이거나 바이트 배열/Uint8Array가 될 수 있음
    const toHex = (v: unknown): string => {
      if (typeof v === 'string') {
        // nostr-tools는 종종 hex 문자열을 반환
        return v.toLowerCase()
      }
      if (v instanceof Uint8Array) {
        return Array.from(v)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      }
      if (Array.isArray(v)) {
        // number[] 로 올 수도 있음
        return (v as number[])
          .map((b) => Number(b).toString(16).padStart(2, '0'))
          .join('')
      }
      // 객체 타입(nprofile/nevent 등)은 원본의 핵심 식별자(pubkey/event id)를 뽑아 hex로 표기
      if (type === 'nprofile' && typeof v === 'object' && v && 'pubkey' in (v as Record<string, unknown>)) {
        return String((v as Record<string, unknown>).pubkey).toLowerCase()
      }
      if (type === 'nevent' && typeof v === 'object' && v && 'id' in (v as Record<string, unknown>)) {
        return String((v as Record<string, unknown>).id).toLowerCase()
      }
      // 그 외에는 표현 불가
      throw new Error('이 타입의 원본 hex를 해석할 수 없습니다.')
    }

    const hex = toHex(data)
    return { ok: true, type, hex }
  } catch (e: unknown) {
    const msg =
      e instanceof Error ? e.message : typeof e === 'string' ? e : '디코딩 중 오류가 발생했습니다.'
    return { ok: false, error: String(msg) }
  }
}

function App() {
  const [input, setInput] = useState('')
  const result = useMemo(() => (input ? decodeNip19(input) : null), [input])

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', padding: '0 16px' }}>
      <h1>Check Nostr</h1>
      <p style={{ color: '#666' }}>
        NIP-19 bech32(npub/nsec/note/nprofile/nevent 등)를 입력하면 원본 hex를 표시합니다.
      </p>

      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="예) npub1..."
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
        ) : result == null ? null : result.ok ? (
          <div>
            <div style={{ marginBottom: 8, color: '#444' }}>type: {result.type}</div>
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
              {result.hex}
            </div>
          </div>
        ) : (
          <div style={{ color: '#c33' }}>오류: {result.error}</div>
        )}
      </div>
    </div>
  )
}

export default App
