import './App.css'
import Nip19Decoder from './components/Nip19Decoder'
import HexToNip19 from './components/HexToNip19'
import EventChecker from './components/EventChecker'

function App() {
  return (
    <div style={{ maxWidth: 1000, margin: '40px auto', padding: '0 16px' }}>
      <h1>Check Nostr</h1>
      <Nip19Decoder />
      <div style={{ height: 24 }} />
      <HexToNip19 />
      <div style={{ height: 32 }} />
      <EventChecker />
    </div>
  )
}

export default App
