import { useMemo, useState } from 'react'
import { nip19 } from 'nostr-tools'
import type { DecodedResult } from 'nostr-tools/nip19';
import { bytesToHex } from 'nostr-tools/utils';

type DecodeResult =
  | { ok: true; type: string; hex: string }
  | { ok: false; error: string }

function decodeNip19(input: string): DecodeResult {
  try {
    const trimmed = input.trim()
    if (!trimmed) return { ok: false, error: 'Please enter a value.' }

    const decoded = nip19.decode(trimmed)

    const toHex = (decoded: DecodedResult) => {
      switch(decoded.type) {
        case 'nprofile':
          return decoded.data.pubkey
        case 'nevent':
          return decoded.data.id
        case 'naddr':
          return `${decoded.data.pubkey}-${decoded.data.kind}`
        case 'nsec':
          return bytesToHex(decoded.data)
        case 'npub':
          return decoded.data
        case 'note':
          return decoded.data
        default:
          return ''
      }
    }

    const hex = toHex(decoded)
    return { ok: true, type: decoded.type, hex }
  } catch (e: unknown) {
    const msg =
      e instanceof Error ? e.message : typeof e === 'string' ? e : 'An error occurred while decoding.'
    return { ok: false, error: String(msg) }
  }
}

export default function Nip19Decoder() {
  const [input, setInput] = useState('')
  const result = useMemo(() => (input ? decodeNip19(input) : null), [input])

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', padding: '0 16px' }}>
      <h2 style={{ marginTop: 0 }}>NIP-19 Decoder</h2>
      <p style={{ color: '#666' }}>
        Enter a NIP-19 bech32 (npub/nsec/note/nprofile/nevent, etc.) to see the original hex.
      </p>

      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="e.g. npub1..."
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
          ''
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
          <div style={{ color: '#c33' }}>Error: {result.error}</div>
        )}
      </div>
    </div>
  )
}
