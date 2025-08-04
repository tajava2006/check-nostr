import type { Profile } from '../types'

export default function NostrProfile({ profile }: { profile: Profile | null }) {
  if (!profile) return null
  return (
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
        </div>
      </div>
    </div>
  )
}