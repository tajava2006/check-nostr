import './App.css'
import Nip19Decoder from './components/Nip19Decoder'

function App() {
  return (
    <div style={{ maxWidth: 720, margin: '40px auto', padding: '0 16px' }}>
      <h1>Check Nostr</h1>
      <Nip19Decoder />
    </div>
  )
}

export default App
