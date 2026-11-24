import { useCallback, useEffect, useRef, useState } from 'react'
import { RollBroadcast, StateSnapshot, WSMessage } from '../types'

const STORAGE_PLAYER_ID_KEY = 'rollhaven_player_id'

export interface UseDiceboundOptions {
  isDM?: boolean
  dmPIN?: string
  enabled?: boolean
}

export function useDiceboundSocket(options: UseDiceboundOptions = {}) {
  const { isDM = false, dmPIN = '', enabled = true } = options
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [playerID, setPlayerID] = useState<string>(() => localStorage.getItem(STORAGE_PLAYER_ID_KEY) || '')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [noteConflict, setNoteConflict] = useState<string | null>(null)
  const [lastBroadcast, setLastBroadcast] = useState<RollBroadcast | null>(null)
  const [kicked, setKicked] = useState(false)
  const [revoked, setRevoked] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  const sendMessage = useCallback((event: string, payload: unknown = {}) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setErrorMsg('Sin conexión al servidor LAN. Reconectando...')
      return false
    }
    const envelope: WSMessage = {
      event,
      player_id: localStorage.getItem(STORAGE_PLAYER_ID_KEY) || undefined,
      payload,
    }
    ws.send(JSON.stringify(envelope))
    return true
  }, [])

  const connect = useCallback(() => {
    if (!mountedRef.current || !enabled) return
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const params = new URLSearchParams()
    if (isDM) {
      params.set('role', 'dm')
      if (dmPIN) params.set('pin', dmPIN)
    } else {
      const savedID = localStorage.getItem(STORAGE_PLAYER_ID_KEY)
      if (savedID) params.set('player_id', savedID)
    }
    const url = `${proto}//${window.location.host}/ws?${params.toString()}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current || wsRef.current !== ws) return
      setConnected(true)
      setErrorMsg(null)
    }

    ws.onmessage = (ev) => {
      if (!mountedRef.current || wsRef.current !== ws) return
      try {
        const msg = JSON.parse(ev.data) as WSMessage<any>
        switch (msg.event) {
          case 'STATE_SYNC': {
            const snap = msg.payload as StateSnapshot
            setSnapshot(snap)
            if (snap.last_result) {
              setLastBroadcast(snap.last_result)
            }
            break
          }
          case 'JOIN_ACK': {
            const pid = msg.player_id || msg.payload?.player?.id
            if (pid) {
              localStorage.setItem(STORAGE_PLAYER_ID_KEY, pid)
              setPlayerID(pid)
              setKicked(false)
              setRevoked(false)
            }
            break
          }
          case 'RESULT_BROADCAST': {
            setLastBroadcast(msg.payload as RollBroadcast)
            break
          }
          case 'NOTE_CONFLICT': {
            setNoteConflict(msg.payload?.message || 'Conflicto de edición: otro participante actualizó esta nota primero.')
            break
          }
          case 'ERROR': {
            setErrorMsg(msg.payload?.message || 'Error en la operación')
            break
          }
          case 'MEMBERSHIP_REVOKED': {
            setRevoked(true)
            setErrorMsg('Tu membresía en esta campaña ha sido revocada por el GM.')
            break
          }
          case 'KICKED': {
            localStorage.removeItem(STORAGE_PLAYER_ID_KEY)
            setPlayerID('')
            setKicked(true)
            setErrorMsg('El Dungeon Master te ha retirado de la mesa.')
            break
          }
        }
      } catch {
        // Ignore malformed packets
      }
    }

    ws.onclose = () => {
      if (!mountedRef.current || wsRef.current !== ws) return
      setConnected(false)
      wsRef.current = null
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current)
      }
      reconnectTimerRef.current = window.setTimeout(() => {
        connect()
      }, 1500)
    }

    ws.onerror = () => {
      if (wsRef.current === ws) {
        ws.close()
      }
    }
  }, [isDM, dmPIN, enabled])

  useEffect(() => {
    mountedRef.current = true
    if (enabled) {
      connect()
    }
    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current)
      }
      if (wsRef.current) {
        const old = wsRef.current
        wsRef.current = null
        old.close()
      }
    }
  }, [connect, enabled])

  const clearSession = useCallback(() => {
    localStorage.removeItem(STORAGE_PLAYER_ID_KEY)
    setPlayerID('')
    setRevoked(false)
    setKicked(false)
  }, [])

  const clearError = useCallback(() => setErrorMsg(null), [])
  const clearNoteConflict = useCallback(() => setNoteConflict(null), [])

  return {
    snapshot,
    connected,
    playerID,
    lastBroadcast,
    errorMsg,
    noteConflict,
    kicked,
    revoked,
    sendMessage,
    clearSession,
    clearError,
    clearNoteConflict,
    reconnectNow: connect,
  }
}
