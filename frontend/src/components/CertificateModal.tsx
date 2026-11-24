import React, { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { CheckCircle2, Cloud, Copy, Download, Globe, Lock, ShieldCheck, Smartphone, Sparkles, X } from 'lucide-react'
import { TLSStatus } from '../types'

interface CertificateModalProps {
  open: boolean
  onClose: () => void
  isDM?: boolean
  dmPIN?: string
  onUsePublicURL?: (url: string) => void
  onUseLocalHTTPS?: (url: string) => void
}

export const CertificateModal: React.FC<CertificateModalProps> = ({
  open,
  onClose,
  isDM = false,
  dmPIN = '',
  onUsePublicURL,
  onUseLocalHTTPS,
}) => {
  const [status, setStatus] = useState<TLSStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'LAN_CA' | 'PUBLIC_TUNNEL'>('LAN_CA')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [tunnelBusy, setTunnelBusy] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const loadStatus = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/tls/status')
      if (res.ok) {
        const data = (await res.json()) as TLSStatus
        setStatus(data)
      }
    } catch {
      // Ignore network issue while modal closes
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      setFeedback(null)
      void loadStatus()
    }
  }, [open])

  if (!open) return null

  const copyText = (key: string, txt: string) => {
    navigator.clipboard?.writeText(txt)
    setCopiedKey(key)
    window.setTimeout(() => setCopiedKey(null), 1600)
  }

  const handleTrustHost = async () => {
    setFeedback('Instalando certificado en el almacén de confianza del equipo...')
    try {
      const res = await fetch('/api/v1/tls/trust-host', {
        method: 'POST',
        headers: dmPIN ? { 'X-DM-PIN': dmPIN } : {},
      })
      const d = await res.json()
      setFeedback(d.message || d.error || 'Proceso completado')
      await loadStatus()
    } catch {
      setFeedback('No se pudo comunicar con el servidor para confiar el certificado.')
    }
  }

  const handleToggleTunnel = async () => {
    if (!status) return
    setTunnelBusy(true)
    setFeedback(
      status.tunnel.active
        ? 'Cerrando túnel HTTPS público...'
        : 'Iniciando túnel HTTPS con certificado público válido (puede tardar 5–12s)...'
    )
    try {
      const endpoint = status.tunnel.active ? '/api/v1/tls/tunnel/stop' : '/api/v1/tls/tunnel/start'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: dmPIN ? { 'X-DM-PIN': dmPIN } : {},
      })
      const tStat = await res.json()
      setStatus((prev) => (prev ? { ...prev, tunnel: tStat } : prev))
      if (tStat.active && tStat.public_url) {
        setFeedback(`✓ Túnel activo con certificado público oficial: ${tStat.public_url}`)
        onUsePublicURL?.(tStat.public_url)
      } else if (tStat.error_message) {
        setFeedback(tStat.error_message)
      } else {
        setFeedback('Túnel público detenido.')
      }
    } catch {
      setFeedback('Error de conexión al controlar el túnel público.')
    } finally {
      setTunnelBusy(false)
    }
  }

  const caURL = status?.ca_cert_http_url || `http://${window.location.hostname}:8080/api/v1/tls/ca.crt`

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl border border-violet-500/35 bg-[#120d22] text-slate-100 shadow-2xl overflow-hidden my-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-violet-500/20 bg-[#0e091b]">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-sm sm:text-base font-extrabold text-amber-200">
                Soluciones de Certificado HTTPS / Candado Seguro
              </h2>
              <p className="text-[11px] text-slate-400">
                Elimina la alerta "Sitio no seguro" y desbloquea sensores/hápticos en iOS y Android
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2 Solutions Switch */}
        <div className="grid grid-cols-2 gap-2 p-3 bg-[#090712] border-b border-violet-500/20">
          <button
            type="button"
            onClick={() => setTab('LAN_CA')}
            className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition ${
              tab === 'LAN_CA'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow'
                : 'bg-[#120d22] text-slate-400 hover:text-slate-200 border border-violet-500/20'
            }`}
          >
            <Lock className="w-4 h-4" />
            Solución 1: CA Local LAN (Sin Internet)
          </button>
          <button
            type="button"
            onClick={() => setTab('PUBLIC_TUNNEL')}
            className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition ${
              tab === 'PUBLIC_TUNNEL'
                ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow'
                : 'bg-[#120d22] text-slate-400 hover:text-slate-200 border border-violet-500/20'
            }`}
          >
            <Cloud className="w-4 h-4" />
            Solución 2: Túnel HTTPS Público (Cero Config)
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4 text-xs max-h-[75vh] overflow-y-auto">
          {feedback && (
            <div className="rounded-xl bg-amber-950/60 border border-amber-400/40 px-3.5 py-2.5 text-amber-200">
              {feedback}
            </div>
          )}

          {loading && !status ? (
            <div className="py-8 text-center text-slate-400">Consultando estado TLS...</div>
          ) : tab === 'LAN_CA' ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-[#090712]/80 border border-violet-500/20 p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-amber-200 flex items-center gap-1.5">
                    Estado en este Host ({status?.host_os || 'OS'}):
                    {status?.host_trusted ? (
                      <span className="text-emerald-300 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" /> Certificado Confiado
                      </span>
                    ) : (
                      <span className="text-amber-300">Pendiente de confianza en este equipo</span>
                    )}
                  </div>
                  {status?.ca_fingerprint_sha256 && (
                    <div className="text-[10px] font-mono text-slate-500 mt-1 break-all">
                      SHA-256: {status.ca_fingerprint_sha256}
                    </div>
                  )}
                </div>

                {isDM && (
                  <button
                    type="button"
                    onClick={handleTrustHost}
                    className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5 shrink-0"
                  >
                    <Sparkles className="w-4 h-4" />
                    {status?.host_trusted ? 'Re-verificar Host' : 'Confiar en este Mac/PC (1 Clic)'}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center bg-[#090712]/70 p-4 rounded-xl border border-violet-500/20">
                <div className="sm:col-span-5 flex flex-col items-center space-y-2">
                  <div className="bg-white p-2.5 rounded-xl shadow">
                    <QRCodeSVG value={caURL} size={132} level="M" />
                  </div>
                  <span className="text-[10px] text-slate-400 text-center">
                    Escanea este QR desde el celular para descargar <strong className="text-amber-200">rollhaven-ca.crt</strong>
                  </span>
                </div>

                <div className="sm:col-span-7 space-y-2.5">
                  <div className="font-bold text-violet-200 flex items-center gap-1.5">
                    <Smartphone className="w-4 h-4 text-amber-400" />
                    Cómo instalar en 30 segundos (una sola vez):
                  </div>
                  <div className="space-y-1.5 text-[11px] text-slate-300 leading-relaxed">
                    <p>
                      <strong className="text-amber-200">iOS (iPhone/iPad):</strong> Descarga desde Safari →{' '}
                      <em>Ajustes → Perfil descargado → Instalar</em> → luego activa el interruptor en{' '}
                      <em>Ajustes → General → Información → Ajustes de confianza de certificados</em>.
                    </p>
                    <p>
                      <strong className="text-emerald-300">Android:</strong> Descarga el <code>.crt</code> →{' '}
                      <em>Ajustes → Seguridad → Cifrado y credenciales → Instalar certificado → Certificado CA</em>.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <a
                      href={caURL}
                      download="rollhaven-ca.crt"
                      className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-bold inline-flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" /> Descargar rollhaven-ca.crt
                    </a>
                    {status?.sslip_https_url && onUseLocalHTTPS && (
                      <button
                        type="button"
                        onClick={() => onUseLocalHTTPS(status.sslip_https_url)}
                        className="px-3 py-1.5 rounded-lg bg-[#120d22] border border-violet-500/35 text-amber-200 font-semibold"
                      >
                        Usar alias sslip.io en QR
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl bg-[#090712]/80 border border-violet-500/20 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-amber-200 flex items-center gap-1.5 text-sm">
                      <Globe className="w-4 h-4 text-sky-400" />
                      Túnel HTTPS con Certificado Público Real
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Usa <code>cloudflared</code> o SSH (<code>localhost.run</code>) para emitir un dominio HTTPS confiable sin que los jugadores instalen nada.
                    </p>
                  </div>
                  {isDM && (
                    <button
                      type="button"
                      disabled={tunnelBusy}
                      onClick={handleToggleTunnel}
                      className={`px-4 py-2 rounded-xl font-bold text-xs transition shrink-0 ${
                        status?.tunnel.active
                          ? 'bg-rose-600 hover:bg-rose-500 text-white'
                          : 'bg-gradient-to-r from-violet-600 to-sky-600 hover:from-violet-500 hover:to-sky-500 text-white'
                      }`}
                    >
                      {tunnelBusy
                        ? 'Conectando...'
                        : status?.tunnel.active
                          ? 'Detener Túnel Público'
                          : 'Activar Túnel HTTPS Público'}
                    </button>
                  )}
                </div>

                {status?.tunnel.active && status.tunnel.public_url ? (
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center pt-2 border-t border-violet-500/20">
                    <div className="sm:col-span-5 flex flex-col items-center">
                      <div className="bg-white p-2.5 rounded-xl shadow">
                        <QRCodeSVG value={status.tunnel.public_url} size={132} level="M" />
                      </div>
                      <span className="text-[10px] text-emerald-300 font-semibold mt-1.5">
                        ✓ Candado HTTPS válido en cualquier celular
                      </span>
                    </div>
                    <div className="sm:col-span-7 space-y-2.5">
                      <div className="text-[11px] text-slate-400">
                        Proveedor activo: <strong className="text-slate-200">{status.tunnel.provider}</strong>
                      </div>
                      <div className="flex items-center gap-2 bg-[#120d22] border border-emerald-500/35 rounded-xl px-3 py-2">
                        <span className="font-mono text-emerald-300 truncate flex-1">{status.tunnel.public_url}</span>
                        <button
                          type="button"
                          onClick={() => copyText('pub', status.tunnel.public_url)}
                          className="text-violet-300 hover:text-white flex items-center gap-1 shrink-0"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          {copiedKey === 'pub' ? 'Copiado' : 'Copiar'}
                        </button>
                      </div>
                      {onUsePublicURL && (
                        <button
                          type="button"
                          onClick={() => {
                            onUsePublicURL(status.tunnel.public_url)
                            onClose()
                          }}
                          className="w-full py-2 rounded-xl bg-emerald-500 text-slate-950 font-bold"
                        >
                          Mostrar esta URL en el QR Principal del Dashboard
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-[#120d22] border border-dashed border-violet-500/25 text-slate-400 text-[11px]">
                    El túnel público está apagado. Pulsa <strong>Activar Túnel HTTPS Público</strong> arriba cuando quieras evitar la instalación del certificado local en los teléfonos.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
