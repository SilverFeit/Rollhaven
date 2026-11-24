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

export interface QuickSheetStats {
  hp_current?: number
  hp_max?: number
  hp_temp?: number
  ac?: number
  speed?: number
  proficiency?: number
  abilities?: Record<'FUE' | 'DES' | 'CON' | 'INT' | 'SAB' | 'CAR', number>
  macros?: { id: string; label: string; formula: string }[]
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
  conditions?: string[]
  aura_radius?: number
  aura_color?: string
  stats_json?: QuickSheetStats
  user_id?: string
  character_id?: string
  avatar_url?: string
  created_at: string
  last_seen: string
  inventory?: InventoryItem[]
  notes?: string
}

export interface SceneCard {
  id: string
  title: string
  subtitle: string
  kind: 'aspect' | 'clock' | string
  segments: number
  filled: number
}

export interface MapScene {
  id: string
  campaign_id: string
  name: string
  map_rows: number
  map_cols: number
  map_image_path: string
  map_grid_color: string
  map_grid_opacity: number
  fog_enabled: boolean
  fog_revealed: string[]
  created_at: string
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
  fog_enabled?: boolean
  fog_revealed?: string[]
  round_number?: number
  scene_cards?: SceneCard[]
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

export interface RollSource {
  kind: 'weapon' | 'spell' | 'skill' | 'save' | 'ability' | 'feature' | 'monster' | 'initiative' | string
  name: string
  subtitle?: string
}

export interface InteractiveRollAction {
  id: string
  kind: 'SAVE' | 'DAMAGE' | 'CHECK' | 'HEAL' | string
  label: string
  ability?: AbilityKey | string
  skill?: string
  dc?: number
  formula?: string
  damage_type?: string
}

export type AbilityKey = 'FUE' | 'DES' | 'CON' | 'INT' | 'SAB' | 'CAR'

export interface RollBroadcast {
  id: number
  timestamp: string
  player_id: string
  player_name: string
  player_color: string
  race_icon: string
  set_type: 'DICE' | 'COIN' | 'MAGIC_8_BALL' | 'SPINNER' | 'WHEEL' | 'ABILITY_CARD'
  result_summary: string
  detail: DiceDetail | CoinDetail | Magic8Detail | SpinnerDetail | WheelDetail | Record<string, unknown> | null
  visibility?: RollVisibility
  command_id?: string
  masked?: boolean
  is_critical?: boolean
  is_fumble?: boolean
  is_edge?: boolean
  out_of_turn?: boolean
  source?: RollSource
  interactive_actions?: InteractiveRollAction[]
  target_dc?: number
  save_outcome?: 'SUCCESS' | 'FAILURE' | string
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
  conditions?: string[]
  aura_radius?: number
  aura_color?: string
  in_initiative?: boolean
  initiative?: number
  avatar_url?: string
  monster_slug?: string
  created_at: string
}

export interface UserAccount {
  id: string
  username: string
  display_name: string
  active_character_id: string
  created_at: string
  last_login_at: string
}

export interface CharacterRecord {
  id: string
  campaign_id: string
  user_id: string
  name: string
  avatar_url: string
  level: number
  species_slug: string
  species_name: string
  class_slug: string
  class_name: string
  subclass_name: string
  background_slug: string
  background_name: string
  sheet_json: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface TemporaryMapEvent {
  kind: 'ping' | 'ruler' | 'aoe' | 'draw' | 'sound'
  sender_name?: string
  color?: string
  x?: number
  y?: number
  from_x?: number
  from_y?: number
  to_x?: number
  to_y?: number
  shape?: 'sphere' | 'cone' | 'cube' | 'line'
  origin_x?: number
  origin_y?: number
  target_x?: number
  target_y?: number
  radius_ft?: number
  points?: { x: number; y: number }[]
  clear?: boolean
  sound_id?: string
  label?: string
  receivedAt?: number
}

export interface TunnelStatus {
  active: boolean
  public_url: string
  provider: string
  error_message?: string
}

export interface TLSStatus {
  ca_cert_http_url: string
  ca_fingerprint_sha256: string
  sslip_https_url: string
  host_os: string
  host_trusted: boolean
  tunnel: TunnelStatus
}

export interface StateSnapshot {
  sequence?: number
  session: SessionConfig
  active_campaign?: Campaign
  campaigns?: Campaign[]
  campaign_sessions?: CampaignSession[]
  users?: UserAccount[]
  characters?: CharacterRecord[]
  players: Player[]
  map_entities: MapEntity[]
  map_scenes?: MapScene[]
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
