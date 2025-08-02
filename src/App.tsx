import './App.css'
import Nip19Decoder from './components/Nip19Decoder'
import HexToNip19 from './components/HexToNip19'

function App() {
  return (
    <div style={{ maxWidth: 720, margin: '40px auto', padding: '0 16px' }}>
      <h1>Check Nostr</h1>
      <Nip19Decoder />
      <div style={{ height: 24 }} />
      <HexToNip19 />
    </div>
  )
}

export default App
