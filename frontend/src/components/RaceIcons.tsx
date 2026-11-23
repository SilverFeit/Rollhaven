import React from 'react'

export interface RaceOption {
  id: string
  label: string
  subtitle: string
}

export const RACES: RaceOption[] = [
  { id: 'human', label: 'Humano', subtitle: 'Versátil' },
  { id: 'elf', label: 'Elfo', subtitle: 'Ágil & Arcano' },
  { id: 'dwarf', label: 'Enano', subtitle: 'Forja & Escudo' },
  { id: 'halfling', label: 'Mediano', subtitle: 'Afortunado' },
  { id: 'dragonborn', label: 'Dracónido', subtitle: 'Aliento Dracónico' },
  { id: 'gnome', label: 'Gnomo', subtitle: 'Ingenio & Ilusión' },
  { id: 'halfelf', label: 'Semielfo', subtitle: 'Carismático' },
  { id: 'halforc', label: 'Semiorco', subtitle: 'Furia Implacable' },
  { id: 'tiefling', label: 'Tiefling', subtitle: 'Linaje Infernal' },
]

export const TOKEN_COLORS = [
  '#a855f7', // Violeta Arcano
  '#f59e0b', // Ámbar Dorado
  '#ef4444', // Carmesí
  '#10b981', // Esmeralda
  '#3b82f6', // Zafiro
  '#ec4899', // Magenta
  '#06b6d4', // Cian
  '#f97316', // Naranja Forja
]

export function getRaceLabel(id: string): string {
  return RACES.find((r) => r.id === id)?.label ?? 'Humano'
}

export const RaceSVG: React.FC<{ race: string; color?: string; className?: string }> = ({
  race,
  color = 'currentColor',
  className = 'w-6 h-6',
}) => {
  switch (race) {
    case 'dm':
      return (
        <svg viewBox="0 0 32 32" className={className} fill="none">
          <path d="M5 26C6 18 9 13 13 11C12 7 14 4 16 4C18 4 20 7 19 11C23 13 26 18 27 26Z" stroke={color} strokeWidth="2" fill="rgba(245,158,11,0.16)" />
          <polygon points="16,14 21,17 21,23 16,26 11,23 11,17" fill="#fde68a" stroke="#1e1b4b" strokeWidth="1.4" />
        </svg>
      )
    case 'elf':
      return (
        <svg viewBox="0 0 32 32" className={className} fill="none">
          <path d="M4 13L10 15C11 10 14 7 16 7C18 7 21 10 22 15L28 13L22 20C21 24 18.5 27 16 27C13.5 27 11 24 10 20L4 13Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          <path d="M16 5V11M13 8H19" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )
    case 'dwarf':
      return (
        <svg viewBox="0 0 32 32" className={className} fill="none">
          <path d="M7 12C7 7 11 4 16 4C21 4 25 7 25 12V15H7V12Z" stroke={color} strokeWidth="2" />
          <path d="M9 15L11 26L16 29L21 26L23 15" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          <path d="M13 18V25M19 18V25" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )
    case 'halfling':
      return (
        <svg viewBox="0 0 32 32" className={className} fill="none">
          <circle cx="16" cy="14" r="7" stroke={color} strokeWidth="2" />
          <path d="M8 27C8 22 11.5 20 16 20C20.5 20 24 22 24 27" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <path d="M13 12C14 10 18 10 19 12" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )
    case 'dragonborn':
      return (
        <svg viewBox="0 0 32 32" className={className} fill="none">
          <path d="M8 6L12 11L16 8L20 11L24 6L23 16L26 21L16 28L6 21L9 16L8 6Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          <path d="M12 16L14 18M20 16L18 18" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </svg>
      )
    case 'gnome':
      return (
        <svg viewBox="0 0 32 32" className={className} fill="none">
          <path d="M16 3L23 14H9L16 3Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          <circle cx="16" cy="19" r="5" stroke={color} strokeWidth="2" />
          <path d="M10 27C12 24 20 24 22 27" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </svg>
      )
    case 'halfelf':
      return (
        <svg viewBox="0 0 32 32" className={className} fill="none">
          <path d="M6 12L10 14C11 9 13.5 6 16 6C18.5 6 21 9 22 14L26 12L22 19C21 24 18.5 26 16 26C13.5 26 11 24 10 19L6 12Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          <circle cx="16" cy="15" r="2.2" fill={color} />
        </svg>
      )
    case 'halforc':
      return (
        <svg viewBox="0 0 32 32" className={className} fill="none">
          <path d="M8 13C8 8 11.5 5 16 5C20.5 5 24 8 24 13V22C24 25 20.5 27 16 27C11.5 27 8 25 8 22V13Z" stroke={color} strokeWidth="2" />
          <path d="M11 23L12.5 17L14 23M18 23L19.5 17L21 23" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        </svg>
      )
    case 'tiefling':
      return (
        <svg viewBox="0 0 32 32" className={className} fill="none">
          <path d="M6 5C6 10 9 12 12 12M26 5C26 10 23 12 20 12" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
          <path d="M10 13C10 9.5 12.7 8 16 8C19.3 8 22 9.5 22 13V20L16 28L10 20V13Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          <path d="M13 16H14.5M17.5 16H19" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </svg>
      )
    case 'human':
    default:
      return (
        <svg viewBox="0 0 32 32" className={className} fill="none">
          <circle cx="16" cy="11" r="5.5" stroke={color} strokeWidth="2" />
          <path d="M6 27C6 21.5 10.5 18 16 18C21.5 18 26 21.5 26 27" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </svg>
      )
  }
}
