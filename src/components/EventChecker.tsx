import { useEffect, useMemo, useRef, useState } from 'react'
import { Relay, type Event, type Filter, SimplePool, nip19 } from 'nostr-tools'
import type { Profile, RelayState } from '../types'
import { isHex32, normalizeHex, normalizeRelayUrl } from '../utils'
import StyledInput from './StyledInput'

const DEFAULT_RELAYS = [
  'wss://relay.damus.io/',
  'wss://nos.lol/',
  'wss://relay.nostr.band/',
  'wss://nostr.mom/',
  'wss://relay.primal.net',
] as const

export default function EventChecker() {
  const [eventIdInput, setEventIdInput] = useState('')
  const [relays, setRelays] = useState<string[]>([...DEFAULT_RELAYS])
  const [queryKey, setQueryKey] = useState(0) // re-query trigger
  const [autoQuery, setAutoQuery] = useState(true)

  // author/pubkey and profile state
  const [authorHex, setAuthorHex] = useState<string>('') // auto-filled from event, editable by user
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileRelay, setProfileRelay] = useState<string | null>(null)
  const [authorError, setAuthorError] = useState<string | null>(null)

  // Keep the first received raw event to show once at the bottom
  const [firstEvent, setFirstEvent] = useState<Event | null>(null)

  // per-relay state map
  const [states, setStates] = useState<Record<string, RelayState>>({})
  const poolRef = useRef<SimplePool | null>(null)

  // If input is hex 64 or a NIP-19 (nevent/note), extract the event id
  const normalizedId = useMemo(() => {
    const raw = eventIdInput.trim()
    if (!raw) return ''
    // 1) accept hex 64 directly
    const hex = normalizeHex(raw)
    if (isHex32(hex)) return hex
    // 2) try to decode NIP-19
    try {
      const { type, data } = nip19.decode(raw)
      if (type === 'nevent') {
        return data.id
      }
      if (type === 'note') {
        return data
      }
    } catch {
      // ignore
    }
    return ''
  }, [eventIdInput])

  const isValidId = useMemo(() => isHex32(normalizedId), [normalizedId])
  const normalizedRelays = useMemo(
    () => relays.map((r) => normalizeRelayUrl(r)).filter(Boolean),
    [relays],
  )

  // When event changes, reset author/profile/firstEvent
  useEffect(() => {
    // clear author if event id was cleared
    if (!normalizedId) {
      setAuthorHex('')
      setProfile(null)
      setProfileRelay(null)
    }
    // reset firstEvent on id change
    setFirstEvent(null)
  }, [normalizedId])

  // SimplePool lifecycle
  useEffect(() => {
    const pool = new SimplePool()
    poolRef.current = pool
    return () => {
      try {
        pool.close(normalizedRelays)
      } catch {
        // ignore close error
      }
      poolRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // mount only

  // Initialize states for new relays and remove for deleted ones
  useEffect(() => {
    setStates((prev) => {
      const next: Record<string, RelayState> = { ...prev }
      for (const r of normalizedRelays) {
        if (!next[r]) {
          next[r] = {
            url: r,
            normalized: r,
            status: 'idle',
            hasEvent: null,
            event: null,
          }
        }
      }
      // remove state entries for relays no longer in the list
      for (const key of Object.keys(next)) {
        if (!normalizedRelays.includes(key)) {
          delete next[key]
        }
      }
      return next
    })
  }, [normalizedRelays])

  // When event id changes, reset per-relay results and trigger re-query
  useEffect(() => {
    setStates(() => {
      const next: Record<string, RelayState> = {}
      for (const r of normalizedRelays) {
        next[r] = {
          url: r,
          normalized: r,
          status: 'idle',
          hasEvent: null,
          event: null,
        }
      }
      return next
    })
    // auto-trigger re-query if id is valid (remove if you want manual)
    setQueryKey((k) => k + 1)
  }, [normalizedId])

  // Connect to each relay and query the event once
  // - Do not re-query if the result is already finalized
  useEffect(() => {
    if (!poolRef.current) return
    if (!isValidId || normalizedRelays.length === 0) return

    const targetId = normalizedId
    const aborters: Array<() => void> = []

    normalizedRelays.forEach((relayUrl) => {
      const st = states[relayUrl]
      const alreadyDone =
        st && (st.hasEvent !== null || st.status === 'error' || st.status === 'closed')
      if (alreadyDone) {
        // skip done relays to preserve previous raw data
        return
      }

      // mark as connecting
      setStates((s) => ({
        ...s,
        [relayUrl]: {
          ...(s[relayUrl] ?? { url: relayUrl, normalized: relayUrl } as RelayState),
          status: 'connecting',
          error: undefined,
        },
      }))

      let relay: Relay | null = null
      let closed = false

      ;(async () => {
        try {
          relay = await Relay.connect(relayUrl)
          if (closed) {
            try { relay.close() } catch { /* ignore */ }
            return
          }
          setStates((s) => ({
            ...s,
            [relayUrl]: { ...(s[relayUrl] as RelayState), status: 'open' },
          }))

          // one-shot query: close on first event or EOSE
          const filter: Filter = { ids: [targetId] }
          let done = false

          const sub = relay!.subscribe([filter], {
            onevent(ev) {
              if (closed || done) return
              if (ev.id === targetId) {
                done = true
                setStates((s) => ({
                  ...s,
                  [relayUrl]: { ...(s[relayUrl] as RelayState), hasEvent: true, event: ev },
                }))
                // store the first received event globally (shown once)
                setFirstEvent((prev) => prev ?? ev)
                // auto-fill author pubkey if user has not set it
                setAuthorHex((prev) => prev || ev.pubkey)
                try { sub.close() } catch { /* ignore */ }
                try { relay!.close() } catch { /* ignore */ }
              }
            },
            oneose() {
              if (closed || done) return
              done = true
              setStates((s) => ({
                ...s,
                [relayUrl]: { ...(s[relayUrl] as RelayState), hasEvent: false, event: null },
              }))
              try { sub.close() } catch { /* ignore */ }
              try { relay!.close() } catch { /* ignore */ }
            },
          })

          aborters.push(() => {
            try { sub.close() } catch { /* ignore */ }
            if (relay) {
              try { relay.close() } catch { /* ignore */ }
            }
            closed = true
          })
        } catch (e: unknown) {
          setStates((s) => ({
            ...s,
            [relayUrl]: {
              ...(s[relayUrl] ?? { url: relayUrl, normalized: relayUrl } as RelayState),
              status: 'error',
              error: e instanceof Error ? e.message : String(e),
              // preserve previous successful data if any
              hasEvent: s[relayUrl]?.hasEvent ?? null,
              event: s[relayUrl]?.event ?? null,
            },
          }))
        }
      })()
    })

    return () => {
      aborters.forEach((fn) => fn())
    }
    // exclude 'states' from deps; we update via setStates closures
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isValidId, normalizedId, normalizedRelays, queryKey])

  const publishToRelay = async (relayUrl: string) => {
    // Event id must be valid
    if (!isValidId || !normalizedId) return
    const pool = poolRef.current
    if (!pool) return

    // We need the full event object to publish; if missing, fail gracefully
    const ev = firstEvent
    if (!ev || ev.id !== normalizedId) {
      // No original event available
      setStates((s) => ({
        ...s,
        [relayUrl]: {
          ...(s[relayUrl] as RelayState),
          publishStatus: 'failed',
          publishError: '원본 이벤트가 없습니다. 먼저 이벤트를 조회해 주세요.',
        },
      }))
      return
    }

    // mark publishing
    setStates((s) => ({
      ...s,
      [relayUrl]: {
        ...(s[relayUrl] as RelayState),
        publishStatus: 'publishing',
        publishError: undefined,
      },
    }))

    try {
      // Publish using nostr-tools Relay API
      const relay = await Relay.connect(relayUrl)
      try {
        await relay.publish(ev)
        // On success, mark as found and keep the event
        setStates((s) => ({
          ...s,
          [relayUrl]: {
            ...(s[relayUrl] as RelayState),
            hasEvent: true,
            event: ev,
            publishStatus: 'success',
            publishError: undefined,
          },
        }))
      } catch (e: unknown) {
        setStates((s) => ({
          ...s,
          [relayUrl]: {
            ...(s[relayUrl] as RelayState),
            publishStatus: 'failed',
            publishError: e instanceof Error ? e.message : String(e),
          },
        }))
      } finally {
        try { relay.close() } catch { /* ignore */ }
      }
    } catch (e: unknown) {
      setStates((s) => ({
        ...s,
        [relayUrl]: {
          ...(s[relayUrl] as RelayState),
          publishStatus: 'failed',
          publishError: e instanceof Error ? e.message : String(e),
        },
      }))
    }
  }

  const addRelay = () => {
    setRelays((prev) => [...prev, ''])
  }
  const updateRelay = (idx: number, v: string) => {
    setRelays((prev) => prev.map((r, i) => (i === idx ? v : r)))
  }
  const removeRelay = (idx: number) => {
    setRelays((prev) => prev.filter((_, i) => i !== idx))
  }

  const triggerQuery = () => setQueryKey((k) => k + 1)

  // When authorHex is valid, query profile (kind 0) and outbox relays (kind 10002)
  // - Use DEFAULT_RELAYS to avoid render loops
  // - NIP-65: no perm implies read/write; include as write-capable
  useEffect(() => {
    // Parse author: try hex, then npub/nprofile
    const raw = authorHex.trim()
    // reset previous decode errors
    if (authorError) setAuthorError(null)

    let pk = raw.toLowerCase().replace(/^0x/, '')
    if (!/^[0-9a-f]{64}$/.test(pk) && raw) {
      try {
        const decoded = nip19.decode(raw)
        if (decoded.type === 'npub' && typeof decoded.data === 'string') {
          pk = decoded.data.toLowerCase()
        } else if (decoded.type === 'nprofile' && decoded.data && typeof decoded.data === 'object' && 'pubkey' in (decoded.data as Record<string, unknown>)) {
          pk = String((decoded.data as Record<string, unknown>).pubkey).toLowerCase()
        } else {
          setAuthorError(`Unsupported NIP-19 type: ${decoded.type}`)
        }
      } catch (e) {
        setAuthorError(e instanceof Error ? e.message : String(e))
      }
    }

    const valid = /^[0-9a-f]{64}$/.test(pk)
    if (!valid) {
      setProfile(null)
      setProfileRelay(null)
      return
    }

    // On valid pk change: keep only default relays
    // This effect depends only on authorHex to avoid re-run loops
    setRelays(() => DEFAULT_RELAYS.map(normalizeRelayUrl))

    let cancelled = false
    // Use DEFAULT_RELAYS as sources (avoid loops)
    const sources = DEFAULT_RELAYS.map(normalizeRelayUrl)

    ;(async () => {
      // 1) kind 0 profile: try each relay; accept first success
      try {
        let profileSet = false
        for (const url of sources) {
          if (cancelled || profileSet) break
          try {
            const r = await Relay.connect(url)
            await new Promise<void>((resolve) => {
              const sub = r.subscribe([{ kinds: [0], authors: [pk], limit: 1 }], {
                onevent(ev) {
                  if (cancelled || profileSet) return
                  if (ev.kind === 0) {
                    try {
                      const parsed = JSON.parse(ev.content)
                      setProfile({ pubkey: pk, ...parsed })
                    } catch {
                      setProfile({ pubkey: pk })
                    }
                    setProfileRelay(url)
                    profileSet = true
                  }
                },
                oneose() {
                  try { sub.close() } catch { /* noop */ }
                  try { r.close() } catch { /* noop */ }
                  resolve()
                }
              })
            })
          } catch {
            // skip
          }
        }
      } catch {
        // ignore
      }

      // 2) kind 10002 NIP-65(outbox): extract write-capable relays and append after defaults
      try {
        let outboxHandled = false
        for (const url of sources) {
          if (cancelled || outboxHandled) break
          try {
            const r = await Relay.connect(url)
            await new Promise<void>((resolve) => {
              const sub = r.subscribe([{ kinds: [10002], authors: [pk], limit: 1 }], {
                onevent(ev) {
                  if (cancelled || outboxHandled) return
                  if (ev.kind === 10002) {
                    const candidates: string[] = []
                    for (const t of ev.tags || []) {
                      const tag0 = (t[0] || '').toString().toLowerCase().trim()
                      const tag1 = (t[1] || '').toString().trim()
                      const permVal = (t.length > 2 ? String(t[2]) : '').toLowerCase().trim()
                      if ((tag0 === 'r' || tag0 === 'relay') && tag1) {
                        const relayUrl = normalizeRelayUrl(tag1)
                        if (!relayUrl) continue
                        // Standard: missing perm means read/write allowed → treat as write-capable
                        if (permVal === '' || permVal === 'write' || permVal === 'w') {
                          candidates.push(relayUrl)
                        }
                      }
                    }
                    const writeRelays = uniq(candidates)

                    // Keep defaults and append unique write relays
                    setRelays(() => {
                      const base = DEFAULT_RELAYS.map(normalizeRelayUrl)
                      // Ignore prev user edits; keep a stable default-first policy
                      return uniq([...base, ...writeRelays])
                    })

                    outboxHandled = true
                  }
                },
                oneose() {
                  try { sub.close() } catch { /* noop */ }
                  try { r.close() } catch { /* noop */ }
                  resolve()
                }
              })
            })
          } catch {
            // skip
          }
        }
      } catch {
        // ignore
      }
    })()

    return () => {
      cancelled = true
    }
  }, [authorHex])

  useEffect(() => {
    if (autoQuery) {
      const t = setTimeout(() => {
        if (isValidId) triggerQuery()
      }, 400)
      return () => {
        clearTimeout(t)
      }
    }
  }, [autoQuery, isValidId, normalizedId, normalizedRelays])

  return (
    <div style={{ maxWidth: 1000, margin: '40px auto', padding: '0 16px' }}>
      <h2 style={{ marginTop: 0 }}>Relay Event Check</h2>
      <p style={{ color: '#666' }}>
        Enter an event id (hex 64) on the left, and one or more relay URLs on the right. The app shows connection status, existence of the event, and raw JSON per relay.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={{ marginBottom: 8, color: '#444' }}>Event ID (hex 64 or nevent/note)</div>
          <StyledInput
            value={eventIdInput}
            onChange={(e) => setEventIdInput(e.target.value)}
            placeholder="e.g. e3a1... or nevent1..."
          />
          {!isValidId && eventIdInput && (
            <div style={{ color: '#c33', marginTop: 6 }}>Invalid event ID.</div>
          )}

          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 6, color: '#444' }}>Author (pubkey, hex 64)</div>
            <input
              value={authorHex}
              onChange={(e) => setAuthorHex(e.target.value)}
              placeholder="e.g. author pubkey (hex 64, npub, nprofile). Auto-filled when an event is specified."
              spellCheck={false}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: 14,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                border:
                  (/^[0-9a-f]{64}$/i.test(authorHex.trim())) ||
                  (() => { try { const d = nip19.decode(authorHex.trim()); return d.type === 'npub' || d.type === 'nprofile' } catch { return !authorHex } })()
                    ? '1px solid #ccc'
                    : '1px solid #c33',
                borderRadius: 8,
                outline: 'none',
              }}
            />
            {authorError && (
              <div style={{ marginTop: 8, color: '#b00020', fontSize: 12, whiteSpace: 'pre-wrap' }}>
                Input decoding error: {authorError}
              </div>
            )}
            {profile && (
              <div
                style={{
                  marginTop: 12,
                  display: 'grid',
                  gridTemplateColumns: '64px 1fr',
                  gap: 12,
                  alignItems: 'start',
                  background: '#fafafa',
                  border: '1px solid #eee',
                  borderRadius: 8,
                  padding: 12,
                  textAlign: 'left',
                }}
              >
                <div>
                  {profile.picture ? (
                    <img
                      src={profile.picture}
                      alt="avatar"
                      style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '1px solid #ddd' }}
                    />
                  ) : (
                    <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#eaeaea', border: '1px solid #ddd' }} />
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {profile.display_name || profile.name || '(no name)'}
                  </div>
                  {profile.about && (
                    <div style={{ color: '#555', marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {profile.about}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, color: '#444', fontSize: 12 }}>
                    {profile.lud16 && <span>⚡ {profile.lud16}</span>}
                    {profile.lud06 && <span>⚡ LNURL</span>}
                    {profile.nip05 && <span>✓ {profile.nip05}</span>}
                    {profile.website && (
                      <a href={profile.website} target="_blank" rel="noreferrer" style={{ color: '#3366cc' }}>
                        website
                      </a>
                    )}
                    {profileRelay && <span style={{ color: '#777' }}>from: {profileRelay}</span>}
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={autoQuery}
                  onChange={(e) => setAutoQuery(e.target.checked)}
                />
                Auto query
              </label>
              <button
                onClick={triggerQuery}
                disabled={!isValidId}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid #ccc',
                  background: isValidId ? '#fff' : '#f3f3f3',
                  cursor: isValidId ? 'pointer' : 'not-allowed',
                }}
              >
                Query
              </button>
            </div>
          </div>
        </div>

        <div>
          <div style={{ marginBottom: 8, color: '#444', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            Relay URLs
            <button
              onClick={addRelay}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid #ccc',
                background: '#fff',
                cursor: 'pointer',
              }}
              aria-label="add relay"
              title="Add relay"
            >
              ＋
            </button>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            {relays.map((r, i) => {
              const url = normalizeRelayUrl(r)
              const st = states[url]
              const statusColor =
                st?.status === 'open'
                  ? '#1a7f37'
                  : st?.status === 'connecting'
                  ? '#915906'
                  : st?.status === 'error'
                  ? '#c33'
                  : st?.status === 'closed'
                  ? '#555'
                  : '#999'
              const isDefault = DEFAULT_RELAYS.map(normalizeRelayUrl).includes(url)
              const isUserOutbox = !isDefault && (i >= DEFAULT_RELAYS.length)

              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
                  <div style={{ position: 'relative' }}>
                    <input
                      value={r}
                      onChange={(e) => updateRelay(i, e.target.value)}
                      placeholder="e.g. relay.damus.io or wss://relay.damus.io"
                      spellCheck={false}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        fontSize: 14,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        border: '1px solid #ccc',
                        borderRadius: 8,
                        outline: 'none',
                        paddingRight: 96,
                      }}
                    />
                    <div style={{ position: 'absolute', right: 8, top: 8, display: 'flex', gap: 6, pointerEvents: 'none' }}>
                      {isDefault && (
                        <span style={{ fontSize: 11, background: '#eef2ff', color: '#334155', border: '1px solid #c7d2fe', borderRadius: 999, padding: '2px 6px', pointerEvents: 'auto' }}>
                          default
                        </span>
                      )}
                      {isUserOutbox && !isDefault && (
                        <span style={{ fontSize: 11, background: '#ecfeff', color: '#155e75', border: '1px solid #a5f3fc', borderRadius: 999, padding: '2px 6px', pointerEvents: 'auto' }}>
                          outbox
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      title={st?.status ?? 'idle'}
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: statusColor,
                        border: '1px solid #ddd',
                        flex: '0 0 auto'
                      }}
                    />
                    {/* Publish button: always visible. Explicit layout to avoid being covered by badges */}
                    <div style={{ flex: '0 0 auto', display: 'inline-flex' }}>
                      <button
                        onClick={() => publishToRelay(url)}
                        disabled={
                          !isValidId ||
                          (st && st.publishStatus === 'publishing') ||
                          (st && st.hasEvent === true)
                        }
                        style={{
                          padding: '6px 10px',
                          borderRadius: 6,
                          border: '1px solid #ccc',
                          background:
                            st && (st.publishStatus === 'publishing' || st.hasEvent === true)
                              ? '#f3f3f3'
                              : '#fff',
                          color: '#222',
                          cursor:
                            st && (st.publishStatus === 'publishing' || st.hasEvent === true)
                              ? 'not-allowed'
                              : 'pointer',
                          display: 'inline-block',
                          visibility: 'visible',
                          zIndex: 1
                        }}
                        title={
                          st && (st.publishStatus === 'publishing' || st.hasEvent === true)
                            ? (st.hasEvent === true ? 'Already exists' : 'Publishing...')
                            : 'Publish this event to this relay'
                        }
                        aria-label="publish to relay"
                      >
                        {st && st.publishStatus === 'publishing' ? 'Publishing...' : 'Publish'}
                      </button>
                    </div>
                    <button
                      onClick={() => removeRelay(i)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 6,
                        border: '1px solid #ccc',
                        background: '#fff',
                        cursor: 'pointer',
                        flex: '0 0 auto'
                      }}
                      title="Remove"
                      aria-label="remove relay"
                    >
                      ×
                    </button>
                  </div>

                  {st && (
                    <div style={{ gridColumn: '1 / span 2' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, color: '#444' }}>
                        <div>
                          Existence:{' '}
                          {st.hasEvent == null ? (
                            <span style={{ color: '#666' }}>Checking/Unknown</span>
                          ) : st.hasEvent ? (
                            <span style={{ color: '#1a7f37' }}>Present</span>
                          ) : (
                            <span style={{ color: '#c33' }}>Absent</span>
                          )}
                        </div>
                        {st.error && <div style={{ color: '#c33' }}>Error: {st.error}</div>}
                        {st.publishStatus === 'failed' && st.publishError && (
                          <div style={{ color: '#c33' }}>
                            Publish failed: {st.publishError}
                          </div>
                        )}
                        {st.publishStatus === 'success' && (
                          <div style={{ color: '#1a7f37' }}>
                            Publish succeeded
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Single raw event (first received) */}
      {firstEvent && (
        <div
          style={{
            marginTop: 16,
            background: '#f7f7f7',
            padding: '12px',
            borderRadius: 8,
            border: '1px solid #eee',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            maxHeight: 360,
            overflowY: 'auto',
            textAlign: 'left',
          }}
        >
{JSON.stringify(firstEvent, null, 2)}
        </div>
      )}
    </div>
  )
}
