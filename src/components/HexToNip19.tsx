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
  if (!raw) return { error: 'Please enter a value.' }
  if (!isHex(raw)) return { error: 'Invalid hex.' }
  if (raw.length % 2 !== 0) return { error: 'Hex length must be even.' }

  const bytes = toUint8(raw)
  const hex = raw

  const out: EncodeItem[] = []

  // Simple branching by byte length
  // 32 bytes: candidates for pubkey, secret key, or event id
  if (bytes.length === 32) {
    // npub (public key) - nostr-tools v2: hex string input
    try {
      const npub = nip19.npubEncode(hex)
      out.push({ label: 'npub (public key)', value: npub })
    } catch {
      /* ignore */
    }
    // nsec (secret key) - Uint8Array input required (nostr-tools v2)
    try {
      const nsec = nip19.nsecEncode(bytes)
      out.push({ label: 'nsec (secret key)', value: nsec })
    } catch {
      /* ignore */
    }
    // note (event id) - hex string input
    try {
      const note = nip19.noteEncode(hex)
      out.push({ label: 'note (event id)', value: note })
    } catch {
      /* ignore */
    }
    // nevent (event object - encode with minimal fields like id)
    try {
      const nevent = nip19.neventEncode({ id: hex } as { id: string; relays?: string[]; author?: string; kind?: number })
      out.push({ label: 'nevent (event, id only)', value: nevent })
    } catch {
      /* ignore */
    }
    // nprofile (profile object - encode with minimal fields like pubkey)
    try {
      const nprofile = nip19.nprofileEncode({ pubkey: hex })
      out.push({ label: 'nprofile (profile, pubkey only)', value: nprofile })
    } catch {
      /* ignore */
    }
  }

  // For arbitrary bytes (8/16/32/64), generic bech32 encoding is uncommon.
  // Add custom hrp support here if needed.

  if (out.length === 0) {
    return {
      error:
        'Cannot encode to known formats. Typically supports 32-byte hex (pubkey, sk, event id): npub/nsec/note/nevent/nprofile.',
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
        Enter a 32-byte hex to see possible NIP-19 formats (npub/nsec/note/nevent/nprofile).
      </p>

      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="e.g. 32-byte hex (pubkey/secret/event id)"
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
          <div style={{ color: '#888' }}>Please enter a value.</div>
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
          <div style={{ color: '#c33' }}>Error: {result.error}</div>
        )}
      </div>
    </div>
  )
}
