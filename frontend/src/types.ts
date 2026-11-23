export type RaceId =
  | 'human'
  | 'elf'
  | 'dwarf'
  | 'halfling'
  | 'dragonborn'
  | 'gnome'
  | 'halfelf'
  | 'halforc'
  | 'tiefling'

export interface InventoryItem {
  id: string
  player_id: string
  name: string
  quantity: number
  description: string
}

export interface Player {
  id: string
  session_id: string
  name: string
  initiative: number
  race_icon: string
  color_hex: string
  character_sheet_path: string
  token_x: number
  token_y: number
  token_hidden: boolean
  turn_order: number
  manual_order: boolean
  is_connected: boolean
  client_ip: string
  user_agent: string
  latency_ms: number
  created_at: string
  last_seen: string
  inventory?: InventoryItem[]
  notes?: string
}

export interface SessionConfig {
  id: string
  created_at: string
  is_active: boolean
  map_enabled: boolean
  map_rows: number
  map_cols: number
  map_image_path: string
  map_grid_color: string
  map_grid_opacity: number
  current_turn_index: number
}

export interface DiceDetail {
  notation: string
  count: number
  sides: number
  modifier: number
  rolls: number[]
  subtotal: number
  total: number
  is_critical: boolean
  is_fumble: boolean
}

export interface CoinDetail {
  raw_value: 'CARA' | 'CRUZ' | 'CANTO'
  display_label: string
  probability_odds: string
  is_edge: boolean
}

export interface Magic8Detail {
  answer: string
  category: 'AFFIRMATIVE' | 'NEUTRAL' | 'NEGATIVE'
  strict_mode: boolean
  question?: string
}

export interface SpinnerDetail {
  winning_index: number
  label: string
  faces: string[]
}

export interface WheelDetail {
  winning_index: number
  option: string
  options: string[]
}

export interface RollBroadcast {
  id: number
  timestamp: string
  player_id: string
  player_name: string
  player_color: string
  race_icon: string
  set_type: 'DICE' | 'COIN' | 'MAGIC_8_BALL' | 'SPINNER' | 'WHEEL'
  result_summary: string
  detail: DiceDetail | CoinDetail | Magic8Detail | SpinnerDetail | WheelDetail | Record<string, unknown>
  is_critical?: boolean
  is_fumble?: boolean
  is_edge?: boolean
  out_of_turn?: boolean
}

export interface ActionLogEntry {
  id: number
  session_id: string
  player_id: string
  player_name: string
  action_type: string
  details: string
  result_json: unknown
  created_at: string
}

export interface StateSnapshot {
  session: SessionConfig
  players: Player[]
  current_turn_index: number
  active_player_id: string
  current_turn_rolls: RollBroadcast[]
  last_result?: RollBroadcast
  action_log: ActionLogEntry[]
  strict_turn_rolls: boolean
  strict_turn_move: boolean
  lan_ip: string
  port: number
}

export interface WSMessage<T = unknown> {
  event: string
  player_id?: string
  payload?: T
}
