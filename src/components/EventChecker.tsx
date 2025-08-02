import { useEffect, useMemo, useRef, useState } from 'react'
import { Relay, type Event, type Filter, SimplePool, nip19 } from 'nostr-tools'

// 유틸
function isHex32(s: string): boolean {
  const v = s.trim().toLowerCase().replace(/^0x/, '')
  return /^[0-9a-f]{64}$/.test(v)
}
function normalizeId(s: string): string {
  return s.trim().toLowerCase().replace(/^0x/, '')
}
function normalizeRelayUrl(url: string): string {
  let u = url.trim()
  if (!u) return ''
  // nostr-tools 이벤트 태그에 스킴/슬래시가 부족한 경우를 보정
  if (!/^wss?:\/\//i.test(u)) u = `wss://${u}`
  try {
    const parsed = new URL(u)
    // trailing slash 제거 및 소문자 호스트 정규화
    parsed.pathname = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.protocol}//${parsed.host}${parsed.pathname || ''}`
  } catch {
    // URL 파싱 실패 시 기본 치환만 적용
    return u.replace(/\/+$/, '')
  }
}

function uniq(arr: string[]): string[] {
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

const DEFAULT_RELAYS = [
  'wss://relay.damus.io/',
  'wss://nos.lol/',
  'wss://relay.nostr.band/',
  'wss://nostr.mom/',
  'wss://relay.primal.net',
] as const

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
  const [relays, setRelays] = useState<string[]>([...DEFAULT_RELAYS])
  const [queryKey, setQueryKey] = useState(0) // 재조회 트리거용
  const [autoQuery, setAutoQuery] = useState(true)

  // author/pubkey 및 프로필 상태
  const [authorHex, setAuthorHex] = useState<string>('') // 자동 채움 후 사용자가 수정 가능
  type Profile = {
    pubkey: string
    name?: string
    display_name?: string
    about?: string
    picture?: string
    banner?: string
    lud16?: string
    lud06?: string
    website?: string
    nip05?: string
  }
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileRelay, setProfileRelay] = useState<string | null>(null)
  const [authorError, setAuthorError] = useState<string | null>(null)

  // 전체 결과 중 첫 번째로 수신한 이벤트(raw)를 별도로 보관하여 단일 위치에서 표시
  const [firstEvent, setFirstEvent] = useState<Event | null>(null)

  // 상태 맵
  const [states, setStates] = useState<Record<string, RelayState>>({})
  const poolRef = useRef<SimplePool | null>(null)

  // 입력이 hex 64이거나 NIP-19(nevent/npub/nprofile/naddr 등)이면 id를 추출
  const normalizedId = useMemo(() => {
    const raw = eventIdInput.trim()
    if (!raw) return ''
    // 1) hex 64 바로 허용
    const hex = normalizeId(raw)
    if (isHex32(hex)) return hex
    // 2) NIP-19 디코딩 시도
    try {
      const { type, data } = nip19.decode(raw)
      // nevent: { id, author?, relays?, kind? }
      if (
        type === 'nevent' &&
        typeof data === 'object' &&
        data &&
        'id' in (data as Record<string, unknown>)
      ) {
        const id = String((data as Record<string, unknown>).id)
        return normalizeId(id)
      }
      // note: 이벤트 id 직접 인코딩된 케이스
      if (type === 'note' && typeof data === 'string') {
        return normalizeId(data)
      }
      // naddr는 식별자가 event id와는 다르므로 여기서는 조회 대상이 아님(확장 시 kind/tag 기반 조회 가능)
      // nnote는 일부 툴에서 쓰는 별칭일 수 있어 note가 아니면 통과
      // 그 외 타입은 여기서는 사용하지 않음
    } catch {
      // 디코드 실패 시 무시
    }
    return ''
  }, [eventIdInput])

  const isValidId = useMemo(() => isHex32(normalizedId), [normalizedId])
  const normalizedRelays = useMemo(
    () => relays.map((r) => normalizeRelayUrl(r)).filter(Boolean),
    [relays],
  )

  // 이벤트 변경 시 author 초기화(입력에 의해 덮어쓸 수 있음)
  useEffect(() => {
    // 이벤트가 지워졌다면 author도 리셋
    if (!normalizedId) {
      setAuthorHex('')
      setProfile(null)
      setProfileRelay(null)
    }
    // 이벤트가 바뀌면 단일 raw 이벤트도 초기화
    setFirstEvent(null)
  }, [normalizedId])

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
  // - 기존 결과는 최대한 보존한다(이미 조회 완료된 릴레이의 결과가 새 릴레이 추가/수정으로 사라지지 않도록 함).
  // - 새로 추가된 릴레이만 기본 상태로 추가.
  // - 이벤트(ID)가 바뀌면 모든 릴레이의 결과를 초기화하여 새 이벤트 기준으로 재조회되도록 함.
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
      // 입력에서 제거된 릴레이는 상태에서도 제거
      for (const key of Object.keys(next)) {
        if (!normalizedRelays.includes(key)) {
          delete next[key]
        }
      }
      return next
    })
  }, [normalizedRelays])

  // 이벤트가 바뀌면 기존 각 릴레이의 조회 결과를 초기화하고 재조회 트리거
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
    // 유효한 id면 자동으로 재조회 트리거(수동 조회만 원하면 아래 줄 제거 가능)
    setQueryKey((k) => k + 1)
  }, [normalizedId])

  // 개별 릴레이 연결 상태 추적 + 이벤트 조회(단발성)
  // - 이미 결과가 확정된 릴레이(connected+hasEvent !== null)는 다시 조회하지 않음(기존 표시 유지).
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
        // 이미 조회가 끝난 릴레이는 스킵하여 기존 raw 데이터가 사라지지 않게 함
        return
      }

      // 조회 시작
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

          // 이벤트 조회: 단발(subscribe 후 EOSE 또는 첫 이벤트 수신 시 즉시 종료)
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
                // 전체 중 첫 번째로 수신한 이벤트를 보관하여 상단에 단 한 번만 표시
                setFirstEvent((prev) => prev ?? ev)
                // 이벤트 author를 자동 세팅(이미 사용자가 직접 입력했다면 유지)
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
              // 에러 시 이전 성공 데이터가 있었다면 보존, 없었다면 null 유지
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
    // states는 내부적으로 확인용으로만 읽고 setStates로 갱신하므로 의존성에서 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // authorHex가 유효하면 프로필(kind 0)과 nip65(kind 10002) 조회
  // - SimplePool을 사용하여 현재 소스 릴레이 세트에서 교체형 이벤트의 최신값만 가져온다.
  // - NIP-65 태그에서 perm 미지정(없음)은 read/write 모두 가능으로 해석하므로 포함한다.
  // - 렌더 루프 방지: authorHex 변경에만 반응하고 normalizedRelays 의존성을 제거한다.
  //   (normalizedRelays를 의존성에 두면 setRelays로 인한 변경 → 재실행 → 무한 루프 위험)
  useEffect(() => {
    // 입력 파싱: hex 우선, 실패 시 npub/nprofile 디코딩 시도
    const raw = authorHex.trim()
    // 이전 오류 초기화
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
          setAuthorError(`지원하지 않는 NIP-19 타입: ${decoded.type}`)
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

    // 유효한 pk로 변경될 때마다: 기본 릴레이만 남기고 나머지는 제거
    // 주의: relays를 DEFAULT로 리셋하면 normalizedRelays가 바뀌어 이 effect가 재실행될 수 있으므로,
    // 이 effect는 authorHex에만 의존하도록 위에서 의존성 배열을 제한했다.
    setRelays(() => DEFAULT_RELAYS.map(normalizeRelayUrl))

    let cancelled = false
    // 프로필/아웃박스 조회용 릴레이 선택: DEFAULT_RELAYS만 사용(루프 방지)
    const sources = DEFAULT_RELAYS.map(normalizeRelayUrl)

    ;(async () => {
      // 1) kind 0 프로필: 최신 하나를 각 릴레이에서 시도하되, 최초 성공만 반영
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

      // 2) kind 10002 NIP-65(아웃박스): 최신 하나 → write 가능한 릴레이들만 추출하여 디폴트 뒤에 재구성
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
                        // 표준: perm 없으면 read/write 모두 허용 → write 가능으로 간주하여 포함
                        if (permVal === '' || permVal === 'write' || permVal === 'w') {
                          candidates.push(relayUrl)
                        }
                      }
                    }
                    const writeRelays = uniq(candidates)

                    // 디폴트 릴레이 개수 이후 인덱스를 모두 제거한 뒤, 새 write 릴레이만 뒤에 붙인다.
                    setRelays(() => {
                      const base = DEFAULT_RELAYS.map(normalizeRelayUrl)
                      // prev는 사용자가 중간에 수정했을 수 있으므로 무시하고, 규칙대로 항상 디폴트만 남김
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
      <h2 style={{ marginTop: 0 }}>릴레이 이벤트 체크</h2>
      <p style={{ color: '#666' }}>
        왼쪽에 이벤트 id(hex 64)를 입력하고, 오른쪽에 하나 이상의 릴레이 주소를 입력하세요. 각 릴레이의 연결 상태와 이벤트 존재 여부 및 raw JSON을 표시합니다.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={{ marginBottom: 8, color: '#444' }}>이벤트 ID (hex 64 또는 nevent/note)</div>
          <input
            value={eventIdInput}
            onChange={(e) => setEventIdInput(e.target.value)}
            placeholder="예) e3a1... 또는 nevent1..."
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
            <div style={{ color: '#c33', marginTop: 6 }}>유효한 이벤트 ID가 아닙니다.</div>
          )}

          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 6, color: '#444' }}>작성자(pubkey, hex 64)</div>
            <input
              value={authorHex}
              onChange={(e) => setAuthorHex(e.target.value)}
              placeholder="예) 작성자 공개키(hex 64, npub, nprofile). 이벤트 지정 시 자동 채워짐"
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
                입력 디코딩 에러: {authorError}
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
              const isDefault = DEFAULT_RELAYS.map(normalizeRelayUrl).includes(url)
              const isUserOutbox = !isDefault && (i >= DEFAULT_RELAYS.length)

              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
                  <div style={{ position: 'relative' }}>
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
                        paddingRight: 96,
                      }}
                    />
                    <div style={{ position: 'absolute', right: 8, top: 8, display: 'flex', gap: 6 }}>
                      {isDefault && (
                        <span style={{ fontSize: 11, background: '#eef2ff', color: '#334155', border: '1px solid #c7d2fe', borderRadius: 999, padding: '2px 6px' }}>
                          default
                        </span>
                      )}
                      {isUserOutbox && !isDefault && (
                        <span style={{ fontSize: 11, background: '#ecfeff', color: '#155e75', border: '1px solid #a5f3fc', borderRadius: 999, padding: '2px 6px' }}>
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
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 단일 Raw Event 표시(첫 수신 이벤트) */}
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
