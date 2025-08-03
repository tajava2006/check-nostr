import { useMemo, useState } from 'react'
import { nip19 } from 'nostr-tools'
import type { EncodeItem } from '../types'
import { isHex32, normalizeHex, toUint8 } from '../utils'
import StyledInput from './StyledInput'
import ResultBlock from './ResultBlock'

function detectAndEncode(hexInput: string): EncodeItem[] | { error: string } {
  const raw = normalizeHex(hexInput)
  if (!raw) return { error: 'Please enter a value.' }
  if (!isHex32(raw)) return { error: 'Invalid hex.' }
  if (raw.length % 2 !== 0) return { error: 'Hex length must be even.' }

  const bytes = toUint8(raw)
  const hex = raw

  const out: EncodeItem[] = []

  // Simple branching by byte length
  // 32 bytes: candidates for pubkey, secret key, or event id
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
    const nevent = nip19.neventEncode({ id: hex })
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

      <StyledInput
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="e.g. 32-byte hex (pubkey/secret/event id)"
      />

      <div style={{ marginTop: 20 }}>
        {!input ? (
          ''
        ) : result == null ? null : Array.isArray(result) ? (
          <div
            style={{
              display: 'grid',
              gap: 8,
            }}
          >
            {result.map((r) => (
              <div key={r.label}>
                <ResultBlock
                  label={r.label}
                  value={r.value}
                />
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
