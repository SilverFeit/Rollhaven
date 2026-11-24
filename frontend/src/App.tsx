import React, { useEffect, useState } from 'react'
import {
  Backpack,
  Dices,
  FileText,
  LogOut,
  MessageSquare,
  NotebookPen,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react'
import { useDiceboundSocket } from './hooks/useDiceboundSocket'
import { PlayerOnboarding } from './components/PlayerOnboarding'
import { DecisionSets } from './components/DecisionSets'
import { CompanionHub } from './components/CompanionHub'
import { CharacterSheetAndRaceTab, InventoryTab, NotesTab } from './components/PlayerTabs'
import { TacticalMapCanvas } from './components/TacticalMapCanvas'
import { DMDashboard } from './components/DMDashboard'
import { RaceSVG } from './components/RaceIcons'
import { AppFooter } from './components/AppFooter'
import { InitiativeOverlayTracker } from './components/InitiativeOverlayTracker'
import { CharacterWizard } from './components/CharacterWizard'
import { InteractiveCharacterSheet } from './components/InteractiveCharacterSheet'
import { ActionChatTracker } from './components/ActionChatTracker'
import { PlayerQuickHotbar } from './components/PlayerQuickHotbar'
import { useIsDesktop } from './lib/useMediaQuery'

type DrawerKind = null | 'SHEET' | 'DECISIONS' | 'COMPANION' | 'INVENTORY' | 'NOTES' | 'RACE'

const PlayerWorkspace: React.FC = () => {
  const {
    snapshot,
    connected,
    playerID,
    lastBroadcast,
    tempEvents,
    errorMsg,
    noteConflict,
    revoked,
    sendMessage,
    clearSession,
    clearError,
    clearNoteConflict,
  } = useDiceboundSocket()

  const [drawer, setDrawer] = useState<DrawerKind>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [trackerOpen, setTrackerOpen] = useState<boolean>(() => window.innerWidth >= 1024)
  const [focusTarget, setFocusTarget] = useState<{ x: number; y: number; tick: number } | null>(null)
  const isDesktop = useIsDesktop()

  const currentPlayer = snapshot?.players.find((p) => p.id === playerID)
  const assignedCharacter = snapshot?.characters?.find((c) => c.id === currentPlayer?.character_id)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawer(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
      <div className="flex-1 flex items-center justify-center bg-[#090712] text-slate-300 text-sm">
        Sincronizando mesa táctica...
      </div>
    )
  }

  const isDisabled = revoked || currentPlayer.membership_status === 'REVOKED'

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 bg-[#090712] text-slate-100 overflow-hidden">
      {/* Compact VTT Top Bar */}
      <header className="h-11 z-30 border-b border-violet-500/25 bg-[#0e091b]/95 backdrop-blur-md px-2.5 sm:px-3.5 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <img src="/app-icon.png" alt="Rollhaven" className="w-8 h-8 rounded-lg border border-violet-500/40 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {currentPlayer.avatar_url ? (
                <img src={currentPlayer.avatar_url} alt={currentPlayer.name} className="w-5 h-5 rounded-full object-cover border border-amber-400/50" />
              ) : (
                <RaceSVG race={currentPlayer.race_icon} color={currentPlayer.color_hex} className="w-4 h-4 shrink-0" />
              )}
              <span className="text-sm font-extrabold text-white truncate">{currentPlayer.name}</span>
              <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-violet-900/60 text-amber-200">
                Inic. {currentPlayer.initiative}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-500 animate-pulse'}`} />
              {assignedCharacter ? `Hoja: ${assignedCharacter.name} (Nv.${assignedCharacter.level})` : 'Sin hoja asignada'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => setDrawer((d) => (d === 'SHEET' ? null : 'SHEET'))}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition ${
              drawer === 'SHEET' ? 'bg-amber-500 text-slate-950' : 'bg-[#120d22] text-amber-200 border border-amber-400/35'
            }`}
          >
            <FileText className="w-3.5 h-3.5" /> Mi Hoja
          </button>

          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 shrink-0 bg-violet-600/35 hover:bg-violet-600 text-violet-100 border border-violet-500/35 transition"
          >
            <Sparkles className="w-3.5 h-3.5" /> Wizard
          </button>

          <button
            type="button"
            onClick={() => setDrawer((d) => (d === 'DECISIONS' ? null : 'DECISIONS'))}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition ${
              drawer === 'DECISIONS' ? 'bg-violet-600 text-white' : 'bg-[#120d22] text-slate-300 border border-violet-500/25'
            }`}
          >
            <Dices className="w-3.5 h-3.5" /> 5 Sets
          </button>

          <button
            type="button"
            onClick={() => setTrackerOpen((v) => !v)}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition ${
              trackerOpen ? 'bg-violet-600 text-white' : 'bg-[#120d22] text-slate-300 border border-violet-500/25'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" /> Tracker/Chat
          </button>

          <button
            type="button"
            onClick={() => setDrawer((d) => (d === 'COMPANION' ? null : 'COMPANION'))}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition ${
              drawer === 'COMPANION' ? 'bg-violet-600 text-white' : 'bg-[#120d22] text-slate-300 border border-violet-500/25'
            }`}
          >
            Diarios
          </button>

          <button
            type="button"
            onClick={() => setDrawer((d) => (d === 'INVENTORY' ? null : 'INVENTORY'))}
            className={`p-1.5 rounded-xl text-xs font-bold shrink-0 transition ${
              drawer === 'INVENTORY' ? 'bg-violet-600 text-white' : 'bg-[#120d22] text-slate-300 border border-violet-500/25'
            }`}
            title="Inventario"
          >
            <Backpack className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setDrawer((d) => (d === 'NOTES' ? null : 'NOTES'))}
            className={`p-1.5 rounded-xl text-xs font-bold shrink-0 transition ${
              drawer === 'NOTES' ? 'bg-violet-600 text-white' : 'bg-[#120d22] text-slate-300 border border-violet-500/25'
            }`}
            title="Notas"
          >
            <NotebookPen className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={clearSession}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-white/5 transition shrink-0"
            title="Cambiar usuario / salir"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Map-First Main Stage */}
      <main className="relative flex-1 min-h-0 overflow-hidden">
        <TacticalMapCanvas
          fullViewport
          session={snapshot.session}
          players={snapshot.players}
          entities={snapshot.map_entities ?? []}
          tempEvents={tempEvents}
          localPlayerID={playerID}
          activePlayerID={snapshot.active_player_id}
          activeCombatantID={snapshot.active_combatant_id}
          localPlayerName={currentPlayer.name}
          localColor={currentPlayer.color_hex}
          focusTarget={focusTarget}
          onMoveToken={(_pid, x, y) => sendMessage('MOVE_TOKEN', { target_x: x, target_y: y })}
          onTempEvent={(ev) => sendMessage('TEMPORARY_MAP_EVENT', ev)}
        />

        {/* Top Overlaid Initiative Portrait Tracker */}
        <div className="pointer-events-none absolute top-2.5 md:top-12 inset-x-0 z-20 flex flex-col items-center gap-2 px-3">
          <InitiativeOverlayTracker
            combatants={snapshot.combatants}
            players={snapshot.players}
            activeCombatantID={snapshot.active_combatant_id}
            activePlayerID={snapshot.active_player_id}
            localPlayerID={playerID}
            roundNumber={snapshot.session.round_number ?? 1}
            onSelectCombatant={(cb) => setFocusTarget({ x: cb.token_x, y: cb.token_y, tick: Date.now() })}
            onEndTurn={() => sendMessage('END_TURN', {})}
          />

          {!assignedCharacter && (
            <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-[#120d22]/90 border border-amber-400/45 px-3.5 py-1 text-xs text-amber-200 shadow-lg">
              <span>Aún no tienes hoja de personaje asignada.</span>
              <button
                type="button"
                onClick={() => setWizardOpen(true)}
                className="px-2.5 py-0.5 rounded-full bg-amber-400 text-slate-950 font-extrabold"
              >
                Crear con Wizard
              </button>
            </div>
          )}

          {(revoked || currentPlayer.membership_status === 'REVOKED') && (
            <div className="pointer-events-auto rounded-xl bg-rose-950/90 border border-rose-500/60 px-4 py-2 text-xs text-rose-100 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
              Membresía revocada por el GM (solo lectura).
            </div>
          )}

          {errorMsg && (
            <div className="pointer-events-auto rounded-xl bg-rose-950/85 border border-rose-500/50 px-3.5 py-2 text-xs text-rose-200 flex items-center gap-3 shadow-lg">
              <span>{errorMsg}</span>
              <button type="button" onClick={clearError} className="underline font-bold">
                OK
              </button>
            </div>
          )}
        </div>

        {/* Floating Right Action Chat & Interactive Roll Tracker */}
        {trackerOpen && (
          <aside className="absolute top-14 sm:top-3 md:top-12 bottom-20 right-2 sm:right-3 z-20 w-[calc(100vw-1rem)] sm:w-80 rounded-2xl border border-violet-500/35 bg-[#120d22]/90 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-3.5 py-2 border-b border-violet-500/20 bg-[#090712]/80 flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-200">
                Tracker de Tiradas &amp; Chat
              </span>
              <button
                type="button"
                onClick={() => setTrackerOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-3">
              <ActionChatTracker
                rolls={snapshot.recent_rolls ?? snapshot.current_turn_rolls ?? []}
                messages={snapshot.chat_messages ?? []}
                players={snapshot.players}
                localPlayerID={playerID}
                activeCharacter={assignedCharacter}
                onRollAction={(payload) => sendMessage('ROLL_ACTION', { ...payload, visibility: 'PUBLIC' })}
                onSendChat={(payload) => sendMessage('CHAT_SEND', payload)}
              />
            </div>
          </aside>
        )}

        {/* Floating Slide-Over Drawer for Character Sheet / Decisions / Chat / Inventory / Notes */}
        {drawer && (
          <aside className="absolute top-2 md:top-12 bottom-20 left-2 sm:left-3 z-30 w-[calc(100vw-1rem)] sm:w-[440px] max-w-full rounded-2xl border border-violet-500/35 bg-[#120d22]/95 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-4 py-2.5 border-b border-violet-500/20 bg-[#090712]/80 flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-amber-200">
                {drawer === 'SHEET'
                  ? 'Hoja de Personaje Interactiva'
                  : drawer === 'DECISIONS'
                    ? '5 Sets de Decisión (crypto/rand)'
                    : drawer === 'COMPANION'
                      ? 'Chat, Diarios & Compendio'
                      : drawer === 'INVENTORY'
                        ? 'Inventario'
                        : drawer === 'NOTES'
                          ? 'Notas de Campaña'
                          : 'Apariencia y PDF'}
              </span>
              <div className="flex items-center gap-2">
                {drawer === 'SHEET' && (
                  <button
                    type="button"
                    onClick={() => setDrawer('RACE')}
                    className="text-[11px] text-violet-300 hover:text-amber-200 underline"
                  >
                    PDF / Token
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDrawer(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3.5">
              {drawer === 'SHEET' && (
                <InteractiveCharacterSheet
                  character={assignedCharacter}
                  fallbackPlayer={currentPlayer}
                  onRoll={(payload) => sendMessage('ROLL_ACTION', { ...payload, visibility: 'PUBLIC' })}
                  onOpenWizard={() => setWizardOpen(true)}
                />
              )}
              {drawer === 'RACE' && (
                <CharacterSheetAndRaceTab
                  player={currentPlayer}
                  onUpdateProfile={(patch) => sendMessage('UPDATE_PROFILE', patch)}
                  onUpdateTactical={(patch) => sendMessage('UPDATE_TACTICAL_PLAYER', patch)}
                  onQuickRoll={(formula) =>
                    sendMessage('ROLL_ACTION', {
                      type: 'DICE',
                      dice_notation: formula,
                      visibility: 'PUBLIC',
                    })
                  }
                />
              )}
              {drawer === 'DECISIONS' && (
                <DecisionSets
                  onRoll={(payload) => sendMessage('ROLL_ACTION', payload)}
                  disabled={isDisabled}
                  lastBroadcast={lastBroadcast}
                  localPlayerID={playerID}
                />
              )}
              {drawer === 'COMPANION' && (
                <CompanionHub
                  campaign={snapshot.active_campaign}
                  activeSession={snapshot.campaign_sessions?.[0]}
                  players={snapshot.players}
                  localPlayerID={playerID}
                  messages={snapshot.chat_messages ?? []}
                  notes={snapshot.campaign_notes ?? []}
                  rollTables={snapshot.roll_tables ?? []}
                  noteConflict={noteConflict}
                  onClearNoteConflict={clearNoteConflict}
                  onSendMessage={(evt, payload) => sendMessage(evt, payload)}
                />
              )}
              {drawer === 'INVENTORY' && (
                <InventoryTab
                  player={currentPlayer}
                  onInventoryAction={(payload) => sendMessage('INVENTORY_ACTION', payload)}
                />
              )}
              {drawer === 'NOTES' && <NotesTab playerID={currentPlayer.id} />}
            </div>
          </aside>
        )}

        {/* Player Quick Action Hotbar: horizontal bar on PC desktop, radial menu on mobile */}
        {isDesktop ? (
          <div className="pointer-events-none absolute bottom-3 inset-x-0 z-30 flex justify-center px-3">
            <PlayerQuickHotbar
              variant="bar"
              player={currentPlayer}
              character={assignedCharacter}
              isMyTurn={
                Boolean(playerID) &&
                (snapshot.active_combatant_id
                  ? snapshot.active_combatant_id === playerID
                  : snapshot.active_player_id === playerID)
              }
              disabled={isDisabled}
              sheetOpen={drawer === 'SHEET'}
              trackerOpen={trackerOpen}
              decisionsOpen={drawer === 'DECISIONS'}
              onRollAction={(payload) => sendMessage('ROLL_ACTION', { ...payload, visibility: 'PUBLIC' })}
              onEndTurn={() => sendMessage('END_TURN', {})}
              onToggleSheet={() => setDrawer((d) => (d === 'SHEET' ? null : 'SHEET'))}
              onToggleTracker={() => setTrackerOpen((v) => !v)}
              onToggleDecisions={() => setDrawer((d) => (d === 'DECISIONS' ? null : 'DECISIONS'))}
            />
          </div>
        ) : (
          <div className="pointer-events-none absolute bottom-4 right-4 z-30 flex items-center justify-end">
            <PlayerQuickHotbar
              variant="radial"
              player={currentPlayer}
              character={assignedCharacter}
              isMyTurn={
                Boolean(playerID) &&
                (snapshot.active_combatant_id
                  ? snapshot.active_combatant_id === playerID
                  : snapshot.active_player_id === playerID)
              }
              disabled={isDisabled}
              sheetOpen={drawer === 'SHEET'}
              trackerOpen={trackerOpen}
              decisionsOpen={drawer === 'DECISIONS'}
              onRollAction={(payload) => sendMessage('ROLL_ACTION', { ...payload, visibility: 'PUBLIC' })}
              onEndTurn={() => sendMessage('END_TURN', {})}
              onToggleSheet={() => setDrawer((d) => (d === 'SHEET' ? null : 'SHEET'))}
              onToggleTracker={() => setTrackerOpen((v) => !v)}
              onToggleDecisions={() => setDrawer((d) => (d === 'DECISIONS' ? null : 'DECISIONS'))}
            />
          </div>
        )}
      </main>

      <CharacterWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        targetUserID={currentPlayer.user_id || localStorage.getItem('rollhaven_user_id') || ''}
        targetPlayerID={currentPlayer.id}
        defaultName={currentPlayer.name}
      />
    </div>
  )
}

export function App() {
  const [route, setRoute] = useState<string>(() => window.location.pathname)
  const [appVersion, setAppVersion] = useState<string>('2.0.0-alpha')
  const [appLicense, setAppLicense] = useState<string>('MIT')

  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    fetch('/api/v1/health')
      .then((r) => r.json())
      .then((d) => {
        if (d.version) setAppVersion(String(d.version))
        if (d.license) setAppLicense(String(d.license))
      })
      .catch(() => {})
  }, [])

  const navigate = (path: string) => {
    window.history.pushState({}, '', path)
    setRoute(path)
  }

  const isDMRoute = route.startsWith('/dm')

  return (
    <div
      className={
        isDMRoute
          ? 'min-h-screen flex flex-col bg-[#090712]'
          : 'h-[100dvh] max-h-[100dvh] w-screen overflow-hidden flex flex-col bg-[#090712]'
      }
    >
      {isDMRoute ? (
        <DMDashboard onGoPlayerView={() => navigate('/')} />
      ) : (
        <PlayerWorkspace />
      )}
      {isDMRoute && <AppFooter version={appVersion} license={appLicense} />}
    </div>
  )
}

export default App
