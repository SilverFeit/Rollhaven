import React, { useEffect, useState } from 'react'
import { Backpack, Dices, FileText, LogOut, Map as MapIcon, NotebookPen } from 'lucide-react'
import { useDiceboundSocket } from './hooks/useDiceboundSocket'
import { PlayerOnboarding } from './components/PlayerOnboarding'
import { TurnBanner } from './components/TurnBanner'
import { DecisionSets } from './components/DecisionSets'
import { CharacterSheetAndRaceTab, InventoryTab, NotesTab } from './components/PlayerTabs'
import { TacticalMapCanvas } from './components/TacticalMapCanvas'
import { DMDashboard } from './components/DMDashboard'
import { RaceSVG } from './components/RaceIcons'

type PlayerTab = 'DECISIONS' | 'MAP' | 'SHEET' | 'INVENTORY' | 'NOTES'

const PlayerWorkspace: React.FC = () => {
  const {
    snapshot,
    connected,
    playerID,
    lastBroadcast,
    errorMsg,
    sendMessage,
    clearSession,
    clearError,
  } = useDiceboundSocket()

  const [tab, setTab] = useState<PlayerTab>('DECISIONS')

  const currentPlayer = snapshot?.players.find((p) => p.id === playerID)
  const mapEnabled = Boolean(snapshot?.session.map_enabled)

  // If DM disables map while player is viewing MAP tab, smoothly return to DECISIONS
  useEffect(() => {
    if (!mapEnabled && tab === 'MAP') {
      setTab('DECISIONS')
    }
  }, [mapEnabled, tab])

  if (!playerID || (snapshot && !currentPlayer)) {
    return (
      <PlayerOnboarding
        connected={connected}
        onJoin={(payload) => sendMessage('JOIN_ROOM', payload)}
      />
    )
  }

  if (!snapshot || !currentPlayer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#090712] text-slate-300 text-sm">
        Sincronizando sesión de mesa...
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#090712] text-slate-100 pb-8">
      {/* Compact Mobile-First Header */}
      <header className="sticky top-0 z-20 border-b border-violet-500/25 bg-[#0e091b]/95 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-3.5 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src="/app-icon.png" alt="Dicebound" className="w-8 h-8 rounded-lg border border-violet-500/40 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <RaceSVG race={currentPlayer.race_icon} color={currentPlayer.color_hex} className="w-4 h-4 shrink-0" />
                <span className="text-sm font-extrabold text-white truncate">{currentPlayer.name}</span>
                <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-violet-900/60 text-amber-200">
                  Inic. {currentPlayer.initiative}
                </span>
              </div>
              <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-500 animate-pulse'}`} />
                {connected ? 'Conectado a la mesa LAN' : 'Reconectando...'}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={clearSession}
            className="p-2 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-white/5 transition"
            title="Cambiar personaje / salir"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        {/* Player Sub-Tabs */}
        <div className="max-w-4xl mx-auto px-3 pb-2.5 flex items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => setTab('DECISIONS')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition ${
              tab === 'DECISIONS' ? 'bg-violet-600 text-white' : 'bg-[#120d22] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Dices className="w-3.5 h-3.5" /> Decisiones
          </button>

          {mapEnabled && (
            <button
              type="button"
              onClick={() => setTab('MAP')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition ${
                tab === 'MAP' ? 'bg-amber-500 text-slate-950' : 'bg-[#120d22] text-amber-300 border border-amber-500/30'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" /> Mapa
            </button>
          )}

          <button
            type="button"
            onClick={() => setTab('SHEET')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition ${
              tab === 'SHEET' ? 'bg-violet-600 text-white' : 'bg-[#120d22] text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" /> Raza y Hoja
          </button>

          <button
            type="button"
            onClick={() => setTab('INVENTORY')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition ${
              tab === 'INVENTORY' ? 'bg-violet-600 text-white' : 'bg-[#120d22] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Backpack className="w-3.5 h-3.5" /> Inventario
          </button>

          <button
            type="button"
            onClick={() => setTab('NOTES')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition ${
              tab === 'NOTES' ? 'bg-violet-600 text-white' : 'bg-[#120d22] text-slate-400 hover:text-slate-200'
            }`}
          >
            <NotebookPen className="w-3.5 h-3.5" /> Notas
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-3.5 pt-4 space-y-4">
        {errorMsg && (
          <div className="rounded-xl bg-rose-950/70 border border-rose-500/50 px-3.5 py-2.5 text-xs text-rose-200 flex items-center justify-between">
            <span>{errorMsg}</span>
            <button type="button" onClick={clearError} className="underline ml-3">
              OK
            </button>
          </div>
        )}

        <TurnBanner
          players={snapshot.players}
          activePlayerID={snapshot.active_player_id}
          localPlayerID={playerID}
          currentTurnRolls={snapshot.current_turn_rolls}
          lastBroadcast={lastBroadcast}
          onEndTurn={() => sendMessage('END_TURN', {})}
        />

        {tab === 'DECISIONS' && (
          <DecisionSets
            onRoll={(payload) => sendMessage('ROLL_ACTION', payload)}
            lastBroadcast={lastBroadcast}
            localPlayerID={playerID}
          />
        )}

        {tab === 'MAP' && mapEnabled && (
          <div className="rounded-2xl border border-violet-500/25 bg-[#120d22]/85 p-3.5 sm:p-4">
            <TacticalMapCanvas
              session={snapshot.session}
              players={snapshot.players}
              localPlayerID={playerID}
              activePlayerID={snapshot.active_player_id}
              onMoveToken={(_pid, x, y) => sendMessage('MOVE_TOKEN', { target_x: x, target_y: y })}
            />
          </div>
        )}

        {tab === 'SHEET' && (
          <CharacterSheetAndRaceTab
            player={currentPlayer}
            onUpdateProfile={(patch) => sendMessage('UPDATE_PROFILE', patch)}
          />
        )}

        {tab === 'INVENTORY' && (
          <InventoryTab
            player={currentPlayer}
            onInventoryAction={(payload) => sendMessage('INVENTORY_ACTION', payload)}
          />
        )}

        {tab === 'NOTES' && <NotesTab playerID={currentPlayer.id} />}
      </main>
    </div>
  )
}

export function App() {
  const [route, setRoute] = useState<string>(() => window.location.pathname)

  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = (path: string) => {
    window.history.pushState({}, '', path)
    setRoute(path)
  }

  if (route.startsWith('/dm')) {
    return <DMDashboard onGoPlayerView={() => navigate('/')} />
  }

  return <PlayerWorkspace />
}

export default App
