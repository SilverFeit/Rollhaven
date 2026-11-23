import React from 'react'

interface AppFooterProps {
  version: string
  license?: string
}

export const AppFooter: React.FC<AppFooterProps> = ({ version, license = 'MIT' }) => {
  return (
    <footer className="mt-auto border-t border-violet-500/15 bg-[#07050e]/95 px-4 py-3 text-center text-[11px] text-slate-400">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1">
        <span className="font-semibold text-amber-200/90">Rollhaven v{version}</span>
        <span className="text-violet-500/60">•</span>
        <span>
          Licencia <strong className="text-slate-300">{license}</strong> (Copyright © 2026 SilverFeit)
        </span>
      </div>
    </footer>
  )
}
