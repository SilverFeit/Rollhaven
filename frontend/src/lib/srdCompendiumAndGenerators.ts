export interface DndCondition {
  id: string
  label: string
  short: string
  color: string
  summary: string
}

export const DND_CONDITIONS: DndCondition[] = [
  { id: 'concentration', label: 'Concentración', short: 'CON', color: '#38bdf8', summary: 'Al recibir daño: Salvación CON DC 10 o mitad del daño.' },
  { id: 'poisoned', label: 'Envenenado', short: 'ENV', color: '#84cc16', summary: 'Desventaja en tiradas de ataque y pruebas de característica.' },
  { id: 'prone', label: 'Derribado', short: 'DER', color: '#f59e0b', summary: 'Ataques cuerpo a cuerpo con ventaja contra él; a distancia con desventaja.' },
  { id: 'blinded', label: 'Cegado', short: 'CEG', color: '#64748b', summary: 'Falla pruebas de vista; ataques con desventaja, enemigos atacan con ventaja.' },
  { id: 'charmed', label: 'Hechizado', short: 'HEC', color: '#ec4899', summary: 'No puede atacar al hechizador; hechizador tiene ventaja social.' },
  { id: 'frightened', label: 'Asustado', short: 'ASU', color: '#a855f7', summary: 'Desventaja mientras vea la fuente del miedo; no puede acercarse.' },
  { id: 'grappled', label: 'Apresado', short: 'APR', color: '#fb923c', summary: 'Velocidad reducida a 0.' },
  { id: 'restrained', label: 'Restringido', short: 'RES', color: '#f97316', summary: 'Velocidad 0; desventaja en ataques y salv. DES.' },
  { id: 'paralyzed', label: 'Paralizado', short: 'PAR', color: '#eab308', summary: 'Incapacitado; golpes a 5 pies son críticos automáticos.' },
  { id: 'stunned', label: 'Aturdido', short: 'ATU', color: '#06b6d4', summary: 'Incapacitado; falla salvaciones de FUE y DES.' },
  { id: 'unconscious', label: 'Inconsciente', short: 'INC', color: '#ef4444', summary: 'Incapacitado y derribado; ataques a 5 pies son críticos.' },
  { id: 'invisible', label: 'Invisible', short: 'INV', color: '#cbd5e1', summary: 'Ataca con ventaja; enemigos atacan con desventaja.' },
  { id: 'blessed', label: 'Bendecido', short: 'BEN', color: '#fde047', summary: '+1d4 a tiradas de ataque y salvación.' },
  { id: 'hexed', label: 'Maldito / Cazado', short: 'MAL', color: '#9333ea', summary: '+1d6 daño necrótico extra y desventaja en característica.' },
  { id: 'exhaustion', label: 'Agotamiento', short: 'AGO', color: '#78716c', summary: 'Penalizaciones acumulativas a pruebas, velocidad y HP.' },
]

export interface SRDMonster {
  name: string
  cr: string
  crNumeric: number
  xp: number
  ac: number
  hp: number
  size: number // 1=1x1, 2=2x2, 3=3x3
  speed: string
  attackBonus: number
  damage: string
  traits: string
}

export const SRD_MONSTERS: SRDMonster[] = [
  { name: 'Goblin', cr: '1/4', crNumeric: 0.25, xp: 50, ac: 15, hp: 7, size: 1, speed: '30 ft', attackBonus: 4, damage: '1d6+2', traits: 'Huida Ágil (Desenganchar/Esconderse como acción adicional)' },
  { name: 'Esqueleto', cr: '1/4', crNumeric: 0.25, xp: 50, ac: 13, hp: 13, size: 1, speed: '30 ft', attackBonus: 4, damage: '1d6+2', traits: 'Vulnerable a daño contundente; inmune a veneno/agotamiento' },
  { name: 'Zombi', cr: '1/4', crNumeric: 0.25, xp: 50, ac: 8, hp: 22, size: 1, speed: '20 ft', attackBonus: 3, damage: '1d6+1', traits: 'Fortaleza No Muerta (CON DC 5 + daño para no caer a 0 HP)' },
  { name: 'Lobo', cr: '1/4', crNumeric: 0.25, xp: 50, ac: 13, hp: 11, size: 1, speed: '40 ft', attackBonus: 4, damage: '2d4+2', traits: 'Tácticas de Manada; derribo FUE DC 11' },
  { name: 'Orco', cr: '1/2', crNumeric: 0.5, xp: 100, ac: 13, hp: 15, size: 1, speed: '30 ft', attackBonus: 5, damage: '1d12+3', traits: 'Agresivo (movimiento adicional hacia un enemigo)' },
  { name: 'Osgo (Bugbear)', cr: '1', crNumeric: 1, xp: 200, ac: 16, hp: 27, size: 1, speed: '30 ft', attackBonus: 4, damage: '2d8+2', traits: 'Ataque Sorpresa (+2d6 daño si sorprende)' },
  { name: 'Lobo Huargo', cr: '1', crNumeric: 1, xp: 200, ac: 14, hp: 37, size: 2, speed: '50 ft', attackBonus: 5, damage: '2d6+3', traits: 'Sentidos Agudos; derribo FUE DC 13' },
  { name: 'Ogro', cr: '2', crNumeric: 2, xp: 450, ac: 11, hp: 59, size: 2, speed: '40 ft', attackBonus: 6, damage: '2d8+4', traits: 'Gran Clava y Jabalina · Gigante Grande 2×2' },
  { name: 'Mímico', cr: '2', crNumeric: 2, xp: 450, ac: 12, hp: 58, size: 1, speed: '15 ft', attackBonus: 5, damage: '1d8+3', traits: 'Adhesivo (Apresa al tocar); Apariencia falsa (cofre/puerta)' },
  { name: 'Cubo Gelatinoso', cr: '2', crNumeric: 2, xp: 450, ac: 6, hp: 84, size: 2, speed: '15 ft', attackBonus: 4, damage: '3d6', traits: 'Transparente (Percepción DC 15); Engullir (3d6 ácido/turno)' },
  { name: 'Caballero', cr: '3', crNumeric: 3, xp: 700, ac: 18, hp: 52, size: 1, speed: '30 ft', attackBonus: 5, damage: '2d6+3', traits: 'Multiataque x2; Liderazgo (+1d4 a aliados)' },
  { name: 'Mago de Batalla', cr: '6', crNumeric: 6, xp: 2300, ac: 12, hp: 40, size: 1, speed: '30 ft', attackBonus: 6, damage: '8d6', traits: 'Espacios hasta Nv. 5 (Bola de Fuego, Rayo, Escudo, Contrahechizo)' },
  { name: 'Dragón Rojo Joven', cr: '10', crNumeric: 10, xp: 5900, ac: 18, hp: 178, size: 2, speed: '40 ft / Vuelo 80 ft', attackBonus: 10, damage: '2d10+6', traits: 'Aliento de Fuego Cono 30ft (16d6 fuego, DES DC 17)' },
]

export interface SRDSpellOrItem {
  kind: 'Conjuro' | 'Objeto'
  name: string
  tag: string
  summary: string
}

export const SRD_SPELLS_AND_ITEMS: SRDSpellOrItem[] = [
  { kind: 'Conjuro', name: 'Bola de Fuego', tag: 'Nv. 3 Evocación · Esfera 20 ft', summary: 'Alcance 150 ft · 8d6 daño de fuego (DES mitad). Usa Plantilla Esfera en el mapa.' },
  { kind: 'Conjuro', name: 'Manos Ardientes', tag: 'Nv. 1 Evocación · Cono 15 ft', summary: '3d6 daño de fuego en cono de 15 pies (DES mitad).' },
  { kind: 'Conjuro', name: 'Proyectil Mágico', tag: 'Nv. 1 Evocación · 120 ft', summary: '3 dardos automáticos de 1d4+1 fuerza cada uno (3d4+3).' },
  { kind: 'Conjuro', name: 'Curar Heridas', tag: 'Nv. 1 Evocación · Toque', summary: 'Restaura 1d8 + modificador de aptitud mágica HP.' },
  { kind: 'Conjuro', name: 'Escudo', tag: 'Nv. 1 Abjuración · Reacción', summary: '+5 CA hasta el inicio de tu siguiente turno e inmunidad a Proyectil Mágico.' },
  { kind: 'Conjuro', name: 'Bendición', tag: 'Nv. 1 Encantamiento · Conc.', summary: 'Hasta 3 criaturas suman +1d4 a tiradas de ataque y salvación.' },
  { kind: 'Conjuro', name: 'Rayo Relampagueante', tag: 'Nv. 3 Evocación · Línea 100 ft', summary: 'Línea de 100×5 ft · 8d6 daño relámpago (DES mitad).' },
  { kind: 'Objeto', name: 'Poción de Curación', tag: 'Común · 50 po', summary: 'Restaura 2d4+2 puntos de golpe al beberla como acción.' },
  { kind: 'Objeto', name: 'Poción de Curación Mayor', tag: 'Poco Común · 150 po', summary: 'Restaura 4d4+4 puntos de golpe.' },
  { kind: 'Objeto', name: 'Bolsa de Contención', tag: 'Poco Común · 500 po', summary: 'Espacio extradimensional de hasta 500 lb (pesa siempre 15 lb).' },
  { kind: 'Objeto', name: 'Capa de Protección', tag: 'Poco Común · Sintonización', summary: '+1 a la Clase de Armadura y +1 a todas las tiradas de salvación.' },
  { kind: 'Objeto', name: 'Arma +1', tag: 'Poco Común · 400 po', summary: '+1 mágico a tiradas de ataque y daño; supera resistencia no mágica.' },
]

// D&D 5e DMG XP thresholds per character level (Easy, Medium, Hard, Deadly)
const XP_THRESHOLDS: Record<number, [number, number, number, number]> = {
  1: [25, 50, 75, 100],
  2: [50, 100, 150, 200],
  3: [75, 150, 225, 400],
  4: [125, 250, 375, 500],
  5: [250, 500, 750, 1100],
  6: [300, 600, 900, 1400],
  7: [350, 750, 1100, 1700],
  8: [450, 900, 1400, 2100],
  9: [550, 1100, 1600, 2400],
  10: [600, 1200, 1900, 2800],
}

export function crToXP(noteOrText: string): number {
  const m = noteOrText.match(/CR\s*([0-9/]+)/i)
  if (!m) return 100
  const map: Record<string, number> = {
    '0': 10, '1/8': 25, '1/4': 50, '1/2': 100,
    '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800,
    '6': 2300, '7': 2900, '8': 3900, '9': 5000, '10': 5900,
  }
  return map[m[1]] ?? 200
}

export function calculateEncounterDifficulty(partySize: number, avgLevel: number, monsterXPs: number[]) {
  const safeSize = Math.max(1, partySize)
  const lvl = Math.max(1, Math.min(10, Math.round(avgLevel)))
  const thr = XP_THRESHOLDS[lvl] || XP_THRESHOLDS[1]
  const budgets = {
    easy: thr[0] * safeSize,
    medium: thr[1] * safeSize,
    hard: thr[2] * safeSize,
    deadly: thr[3] * safeSize,
  }
  const baseXP = monsterXPs.reduce((a, b) => a + b, 0)
  const count = monsterXPs.length
  let mult = 1
  if (count === 2) mult = 1.5
  else if (count >= 3 && count <= 6) mult = 2
  else if (count >= 7 && count <= 10) mult = 2.5
  else if (count >= 11 && count <= 14) mult = 3
  else if (count >= 15) mult = 4
  const adjustedXP = Math.round(baseXP * mult)

  let label: 'Trivial' | 'Fácil' | 'Medio' | 'Difícil' | 'Mortal' = 'Trivial'
  if (adjustedXP >= budgets.deadly) label = 'Mortal'
  else if (adjustedXP >= budgets.hard) label = 'Difícil'
  else if (adjustedXP >= budgets.medium) label = 'Medio'
  else if (adjustedXP >= budgets.easy) label = 'Fácil'

  return { baseXP, adjustedXP, mult, label, budgets }
}

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

export function generateTavern() {
  const prefixes = ['El Dragón', 'La Jarra', 'El Grifo', 'La Daga', 'El Cuervo', 'La Luna', 'El Barril']
  const suffixes = ['Dormido', 'Dorado', 'Tuerto', 'Herrumbroso', 'Cantor', 'de Plata', 'Escarlata']
  const keepers = ['Bram Barbalarga (Enano jubilado)', 'Lyra Ojo-Vivo (Mediana inquieta)', 'Garrick el Manco (Humano ex-mercenario)', 'Seraphina (Tiefling alquimista)']
  const vibes = ['Humo de pipa dulce y laúd animado', 'Silencio tenso con capuchas en los rincones', 'Calor de hogar y risas de mineros', 'Iluminación tenue de velas azules arcanas']
  const drinks = ['Cerveza negra enana (4 pc)', 'Hidromiel del Norte (2 pp)', 'Vino especiado élfico (5 pp)', 'Brebaje del Alquimista (1 po)']
  const foods = ['Estofado de jabalí con pan negro (3 pp)', 'Pastel de trucha y hierbas (2 pp)', 'Queso curado y aceitunas (1 pp)', 'Costillas glaseadas al fuego (4 pp)']
  const rumors = [
    'Un carro de suministros desapareció hace tres noches cerca del Puente Viejo.',
    'La anciana del molino paga 80 po por recuperar un medallón en la cripta inundada.',
    'Vieron luces violetas saliendo de la torre abandonada justo tras el eclipse.',
    'Los guardias buscan aventureros discretos: alguien roba armas del cuartel.',
  ]
  const r1 = pick(rumors)
  const r2 = pick(rumors.filter((x) => x !== r1))
  return {
    title: `${pick(prefixes)} ${pick(suffixes)}`,
    keeper: pick(keepers),
    vibe: pick(vibes),
    menu: [pick(drinks), pick(drinks), pick(foods)],
    rumors: [r1, r2],
  }
}

export function generateNPC() {
  const names = ['Aldric', 'Kaelen', 'Vesper', 'Thokk', 'Sola', 'Milo', 'Nyx', 'Gideon', 'Elara']
  const surnames = ['Valen', 'Ceniciento', 'Fierro', 'Sombra', 'Bruma', 'Piedrafuerte', 'Viento']
  const races = ['Humano', 'Elfo del Bosque', 'Enano de las Colinas', 'Mediano', 'Tiefling', 'Semielfo', 'Gnomo']
  const roles = ['Herrero de armas', 'Boticario', 'Escriba arcano', 'Explorador retirado', 'Contrabandista', 'Sacerdote viajero', 'Cartógrafo']
  const quirks = ['Siempre juega con una moneda antigua', 'Habla en susurros rápidos', 'Lleva un cuervo mudo en el hombro', 'Tiene una cicatriz rúnica en la muñeca', 'Mira las salidas al entrar']
  const secrets = [
    'Debe una fuerte suma al gremio de ladrones local.',
    'Es testigo clave del asesinato de un noble.',
    'Guarda un mapa parcial hacia una cámara sellada.',
    'Trabaja en secreto como informante de un cultista.',
  ]
  return {
    name: `${pick(names)} ${pick(surnames)}`,
    race: pick(races),
    role: pick(roles),
    quirk: pick(quirks),
    secret: pick(secrets),
  }
}

export function generateMagicShop() {
  const names = ['Emporio del Búho Astral', 'Reliquias de Bronce y Éter', 'El Grimorio Curioso', 'Bazar de la Chispa Arcana']
  const keepers = ['Maestro Orin (Gnomo inventor)', 'Madame Vael (Elfa erudita)', 'Zorath (Dracónido coleccionista)']
  const shuffled = [...SRD_SPELLS_AND_ITEMS.filter((i) => i.kind === 'Objeto')].sort(() => Math.random() - 0.5)
  const extras = [
    { name: 'Pergamino de Nivel 1', tag: '100 po', summary: 'Contiene un conjuro arcano o divino de nivel 1.' },
    { name: 'Antitoxina Alquímica', tag: '50 po', summary: 'Ventaja en salvaciones contra veneno durante 1 hora.' },
    { name: 'Polvo de Desaparición', tag: '300 po', summary: 'Invisibilidad 2d4 minutos para criaturas en 10 ft.' },
  ]
  return {
    name: pick(names),
    keeper: pick(keepers),
    stock: [...shuffled.slice(0, 3), ...extras.slice(0, 2)],
  }
}

// Synthesized Web Audio API Soundboard (0 KB asset footprint)
let sbCtx: AudioContext | null = null
function getSBContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!sbCtx) sbCtx = new Ctor()
  if (sbCtx.state === 'suspended') void sbCtx.resume().catch(() => {})
  return sbCtx
}

export const SOUNDBOARD_CLIPS = [
  { id: 'sword', label: '⚔️ Espadas' },
  { id: 'fire', label: '🔥 Explosión' },
  { id: 'roar', label: '🐉 Rugido' },
  { id: 'chest', label: '💎 Cofre / Botín' },
  { id: 'trap', label: '⚠️ Trampa' },
  { id: 'bell', label: '🍺 Campana' },
  { id: 'victory', label: '🎺 Victoria' },
  { id: 'drums', label: '🥁 Combate' },
] as const

export function playTabletopSound(soundId: string) {
  const ctx = getSBContext()
  if (!ctx) return
  const now = ctx.currentTime

  const tone = (freqStart: number, freqEnd: number, dur: number, type: OscillatorType, gainVal = 0.2, offset = 0) => {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freqStart, now + offset)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + offset + dur)
    g.gain.setValueAtTime(gainVal, now + offset)
    g.gain.exponentialRampToValueAtTime(0.001, now + offset + dur)
    osc.connect(g)
    g.connect(ctx.destination)
    osc.start(now + offset)
    osc.stop(now + offset + dur + 0.02)
  }

  switch (soundId) {
    case 'sword':
      tone(2400, 900, 0.14, 'triangle', 0.22, 0)
      tone(3200, 1400, 0.18, 'sine', 0.16, 0.03)
      break
    case 'fire':
      tone(140, 32, 0.55, 'sawtooth', 0.28, 0)
      tone(95, 28, 0.6, 'square', 0.16, 0.04)
      break
    case 'roar':
      tone(160, 52, 0.65, 'sawtooth', 0.24, 0)
      tone(110, 44, 0.7, 'triangle', 0.22, 0.05)
      break
    case 'chest':
      tone(523.25, 523.25, 0.14, 'sine', 0.2, 0)
      tone(659.25, 659.25, 0.14, 'sine', 0.2, 0.1)
      tone(783.99, 783.99, 0.25, 'triangle', 0.22, 0.2)
      break
    case 'trap':
      tone(880, 220, 0.22, 'sawtooth', 0.24, 0)
      tone(220, 90, 0.25, 'square', 0.18, 0.14)
      break
    case 'bell':
      tone(987, 987, 0.45, 'sine', 0.22, 0)
      tone(1480, 1480, 0.3, 'triangle', 0.12, 0)
      break
    case 'victory':
      tone(440, 440, 0.14, 'triangle', 0.2, 0)
      tone(554.37, 554.37, 0.14, 'triangle', 0.2, 0.13)
      tone(659.25, 659.25, 0.16, 'triangle', 0.22, 0.26)
      tone(880, 880, 0.42, 'triangle', 0.26, 0.4)
      break
    case 'drums':
      tone(110, 52, 0.16, 'sine', 0.3, 0)
      tone(110, 52, 0.16, 'sine', 0.28, 0.22)
      tone(130, 58, 0.25, 'sine', 0.34, 0.44)
      break
  }
}
