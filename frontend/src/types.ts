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

export type RollVisibility = 'PUBLIC' | 'ROLLER_AND_GM' | 'GM_ONLY' | 'ROLLER_ONLY'
export type NoteVisibility = 'PRIVATE' | 'GM_SHARED' | 'CAMPAIGN' | 'SELECTED_USERS'
export type ChatVisibility = 'CAMPAIGN' | 'GM_WHISPER' | 'SELECTED_USERS'

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
  role?: 'PLAYER' | 'GM' | string
  membership_status?: 'ACTIVE' | 'REVOKED' | string
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
  active_campaign_id?: string
}

export interface Campaign {
  id: string
  name: string
  description: string
  system_name: string
  status: 'ACTIVE' | 'ARCHIVED' | string
  created_at: string
  updated_at: string
}

export interface CampaignSession {
  id: string
  campaign_id: string
  title: string
  status: 'PLANNED' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | string
  started_at: string
  ended_at?: string
  created_at: string
}

export interface CampaignNote {
  id: string
  campaign_id: string
  owner_id: string
  owner_name: string
  title: string
  body: string
  category: string
  visibility: NoteVisibility | string
  recipient_ids: string[]
  allow_edit: boolean
  version: number
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: string
  campaign_id: string
  session_id: string
  author_id: string
  author_name: string
  author_role: string
  author_color: string
  body: string
  visibility: ChatVisibility | string
  recipient_ids: string[]
  command_id?: string
  created_at: string
}

export interface RollTableEntry {
  id: string
  label: string
  weight: number
  detail?: string
}

export interface RollTable {
  id: string
  campaign_id: string
  name: string
  description: string
  entries: RollTableEntry[]
  created_at: string
}

export interface AuditEvent {
  id: number
  campaign_id: string
  actor_id: string
  actor_name: string
  action: string
  summary: string
  created_at: string
}

export interface DiceTerm {
  kind: 'dice' | 'constant'
  notation?: string
  count?: number
  sides?: number
  rolls?: number[]
  kept?: number[]
  subtotal?: number
  value: number
  sign: number
}

export interface DiceDetail {
  notation: string
  normalized_expression?: string
  count: number
  sides: number
  modifier: number
  rolls: number[]
  subtotal: number
  total: number
  terms?: DiceTerm[]
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
  detail: DiceDetail | CoinDetail | Magic8Detail | SpinnerDetail | WheelDetail | Record<string, unknown> | null
  visibility?: RollVisibility
  command_id?: string
  masked?: boolean
  is_critical?: boolean
  is_fumble?: boolean
  is_edge?: boolean
  out_of_turn?: boolean
}

export interface ActionLogEntry {
  id: number
  session_id: string
  campaign_id?: string
  player_id: string
  roller_id?: string
  player_name: string
  action_type: string
  details: string
  visibility?: RollVisibility | string
  command_id?: string
  result_json: unknown
  created_at: string
}

export type MapEntityKind = 'enemy' | 'trap' | 'item' | 'npc' | 'hazard' | 'door'

export interface MapEntity {
  id: string
  session_id: string
  kind: MapEntityKind
  name: string
  x: number
  y: number
  size: number
  color_hex: string
  hp_current: number
  hp_max: number
  note: string
  is_hidden: boolean
  created_at: string
}

export interface StateSnapshot {
  sequence?: number
  session: SessionConfig
  active_campaign?: Campaign
  campaigns?: Campaign[]
  campaign_sessions?: CampaignSession[]
  players: Player[]
  map_entities: MapEntity[]
  campaign_notes?: CampaignNote[]
  chat_messages?: ChatMessage[]
  roll_tables?: RollTable[]
  audit_events?: AuditEvent[]
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
