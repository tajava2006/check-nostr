import { type Event } from 'nostr-tools'

export type EncodeItem = {
  label: string
  value: string
}

export type RelayState = {
  url: string
  normalized: string
  status: 'idle' | 'connecting' | 'open' | 'error' | 'closed'
  hasEvent: boolean | null
  event: Event | null
  error?: string
  publishStatus?: 'idle' | 'publishing' | 'success' | 'failed'
  publishError?: string
}

export type Profile = {
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