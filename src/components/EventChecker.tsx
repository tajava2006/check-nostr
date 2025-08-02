import { useEffect, useMemo, useRef, useState } from 'react'
import { Relay, type Event, type Filter, SimplePool } from 'nostr-tools'

// 유틸
function isHex32(s: string): boolean {
  const v = s.trim().toLowerCase().replace(/^0x/, '')
  return /^[0-9a-f]{64}$/.test(v)
}
function normalizeId(s: string): string {
  return s.trim().toLowerCase().replace(/^0x/, '')
}
function normalizeRelayUrl(url: string): string {
  const u = url.trim()
  if (!u) return ''
  // 기본 프로토콜 보정: wss://를 붙여줌
  if (!/^wss?:\/\//i.test(u)) return `wss://${u}`
  return u
}

type RelayState = {
  url: string
  normalized: string
  status: 'idle' | 'connecting' | 'open' | 'error' | 'closed'
  hasEvent: boolean | null
  event: Event | null
  error?: string
}

export default function EventChecker() {
  const [eventIdInput, setEventIdInput] = useState('')
  const [relays, setRelays] = useState<string[]>(['wss://relay.damus.io'])
  const [queryKey, setQueryKey] = useState(0) // 재조회 트리거용
  const [autoQuery, setAutoQuery] = useState(true)

  // 상태 맵
  const [states, setStates] = useState<Record<string, RelayState>>({})
  const poolRef = useRef<SimplePool | null>(null)

  const normalizedId = useMemo(() => normalizeId(eventIdInput), [eventIdInput])
  const isValidId = useMemo(() => isHex32(normalizedId), [normalizedId])
  const normalizedRelays = useMemo(
    () => relays.map((r) => normalizeRelayUrl(r)).filter(Boolean),
    [relays],
  )

  // Pool 라이프사이클
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
  }, []) // 최초 1회

  // 상태 초기화
  useEffect(() => {
    const init: Record<string, RelayState> = {}
    for (const r of normalizedRelays) {
      init[r] = {
        url: r,
        normalized: r,
        status: 'idle',
        hasEvent: null,
        event: null,
      }
    }
    setStates(init)
  }, [normalizedRelays, queryKey])

  // 개별 릴레이 연결 상태 추적 + 이벤트 조회
  useEffect(() => {
    if (!poolRef.current) return
    // 현재는 Relay.connect를 개별로 사용. 필요 시 pool.get/subscribe로 리팩토링 가능.
    // const pool = poolRef.current

    if (!isValidId || normalizedRelays.length === 0) return

    const targetId = normalizedId

    // 각 릴레이별로 확인
    const aborters: Array<() => void> = []

    normalizedRelays.forEach((relayUrl) => {
      // 연결 상태 추적을 위해 직접 Relay 인스턴스도 사용
      setStates((s) => ({
        ...s,
        [relayUrl]: { ...(s[relayUrl] ?? { url: relayUrl, normalized: relayUrl } as RelayState), status: 'connecting', hasEvent: null, event: null, error: undefined },
      }))

      let relay: Relay | null = null
      let closed = false

      ;(async () => {
        try {
          relay = await Relay.connect(relayUrl)
          if (closed) {
            try { relay.close() } catch {
              // ignore
            }
            return
          }
          setStates((s) => ({
            ...s,
            [relayUrl]: { ...(s[relayUrl] as RelayState), status: 'open' },
          }))

          // 이벤트 조회
          const filter: Filter = { ids: [targetId] }
          let got: Event | null = null

          // 개별 릴레이에 대해 단발성 쿼리
          // Relay API 직접 사용: sub/unsub
          const sub = relay.subscribe([filter], {
            onevent(ev) {
              if (closed) return
              if (ev.id === targetId) {
                got = ev
                setStates((s) => ({
                  ...s,
                  [relayUrl]: { ...(s[relayUrl] as RelayState), hasEvent: true, event: ev },
                }))
              }
            },
            oneose() {
              if (closed) return
              if (!got) {
                setStates((s) => ({
                  ...s,
                  [relayUrl]: { ...(s[relayUrl] as RelayState), hasEvent: false, event: null },
                }))
              }
              try {
                sub.close()
              } catch {
                // ignore
              }
            },
          })
          aborters.push(() => {
            try {
              sub.close()
            } catch {
              // ignore
            }
          })
        } catch (e: unknown) {
          setStates((s) => ({
            ...s,
            [relayUrl]: {
              ...(s[relayUrl] ?? { url: relayUrl, normalized: relayUrl } as RelayState),
              status: 'error',
              error: e instanceof Error ? e.message : String(e),
              hasEvent: null,
              event: null,
            },
          }))
        }
      })()

      aborters.push(() => {
        closed = true
        if (relay) {
          try {
            relay.close()
          } catch {
            // ignore
          }
        }
      })
    })

    return () => {
      aborters.forEach((fn) => fn())
    }
  }, [isValidId, normalizedId, normalizedRelays, queryKey])

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
      <h2 style={{ marginTop: 0 }}>릴레이 이벤트 체크</h2>
      <p style={{ color: '#666' }}>
        왼쪽에 이벤트 id(hex 64)를 입력하고, 오른쪽에 하나 이상의 릴레이 주소를 입력하세요. 각 릴레이의 연결 상태와 이벤트 존재 여부 및 raw JSON을 표시합니다.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={{ marginBottom: 8, color: '#444' }}>이벤트 ID (hex 64)</div>
          <input
            value={eventIdInput}
            onChange={(e) => setEventIdInput(e.target.value)}
            placeholder="예) e3a1... (64 hex)"
            spellCheck={false}
            style={{
              width: '100%',
              padding: '12px 14px',
              fontSize: 16,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              border: isValidId || !eventIdInput ? '1px solid #ccc' : '1px solid #c33',
              borderRadius: 8,
              outline: 'none',
            }}
          />
          {!isValidId && eventIdInput && (
            <div style={{ color: '#c33', marginTop: 6 }}>유효한 64자리 hex가 아닙니다.</div>
          )}

          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={autoQuery}
                onChange={(e) => setAutoQuery(e.target.checked)}
              />
              자동 조회
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
              조회
            </button>
          </div>
        </div>

        <div>
          <div style={{ marginBottom: 8, color: '#444', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            릴레이 주소들
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
              title="릴레이 추가"
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

              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
                  <input
                    value={r}
                    onChange={(e) => updateRelay(i, e.target.value)}
                    placeholder="예) relay.damus.io 또는 wss://relay.damus.io"
                    spellCheck={false}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      fontSize: 14,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      border: '1px solid #ccc',
                      borderRadius: 8,
                      outline: 'none',
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      title={st?.status ?? 'idle'}
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: statusColor,
                        border: '1px solid #ddd',
                      }}
                    />
                    <button
                      onClick={() => removeRelay(i)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 6,
                        border: '1px solid #ccc',
                        background: '#fff',
                        cursor: 'pointer',
                      }}
                      title="삭제"
                      aria-label="remove relay"
                    >
                      ×
                    </button>
                  </div>

                  {st && (
                    <div style={{ gridColumn: '1 / span 2' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, color: '#444' }}>
                        <div>
                          존재 여부:{' '}
                          {st.hasEvent == null ? (
                            <span style={{ color: '#666' }}>확인 중/미확인</span>
                          ) : st.hasEvent ? (
                            <span style={{ color: '#1a7f37' }}>있음</span>
                          ) : (
                            <span style={{ color: '#c33' }}>없음</span>
                          )}
                        </div>
                        {st.error && <div style={{ color: '#c33' }}>에러: {st.error}</div>}
                      </div>

                      {st.event && (
                        <pre
                          style={{
                            marginTop: 8,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            background: '#f7f7f7',
                            padding: '12px',
                            borderRadius: 8,
                            border: '1px solid #eee',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            fontSize: 12,
                            maxHeight: 320,
                            overflow: 'auto',
                          }}
                        >
{JSON.stringify(st.event, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
