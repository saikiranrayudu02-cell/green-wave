import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, Share2, PlusSquare, X, Smartphone, Tablet, ShieldCheck, Sparkles } from 'lucide-react'
import { usePWAInstall } from '../lib/usePWAInstall'

export default function PWAInstallPrompt({
  forceOpen,
  onClose,
}: {
  forceOpen?: boolean
  onClose?: () => void
}) {
  const { canInstall, isInstalled, isIOS, promptInstall } = usePWAInstall()
  const [isOpen, setIsOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (forceOpen) {
      setIsOpen(true)
      return
    }

    // Auto-prompt on load after 2 seconds if not installed and not dismissed in this session
    const hasSeen = sessionStorage.getItem('gw_pwa_prompt_seen')
    if (!isInstalled && !hasSeen && !dismissed) {
      const timer = window.setTimeout(() => {
        setIsOpen(true)
      }, 1800)
      return () => window.clearTimeout(timer)
    }
  }, [forceOpen, isInstalled, dismissed])

  const handleClose = () => {
    setIsOpen(false)
    setDismissed(true)
    sessionStorage.setItem('gw_pwa_prompt_seen', 'true')
    if (onClose) onClose()
  }

  const handleInstallClick = async () => {
    const success = await promptInstall()
    if (success) {
      handleClose()
    }
  }

  if (isInstalled && !forceOpen) return null

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-night-950/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-ops-cyan/30 bg-night-900/95 p-5 shadow-[0_0_50px_rgba(56,196,224,0.18)] backdrop-blur-md"
          >
            {/* Top decorative glow */}
            <div className="absolute -top-10 left-1/2 -translate-x-1/2 h-20 w-48 bg-ops-cyan/20 blur-2xl pointer-events-none rounded-full" />

            <button
              type="button"
              onClick={handleClose}
              className="absolute right-3.5 top-3.5 flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-400 hover:text-slate-100 hover:bg-white/10 transition-colors"
              aria-label="Close"
            >
              <X size={15} />
            </button>

            <div className="flex items-start gap-3.5">
              <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-ops-cyan/40 bg-gradient-to-b from-night-800 to-night-950 shadow-[0_0_20px_rgba(56,196,224,0.25)]">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
                  <path
                    d="M2 16.5 L7 16.5 L9.5 9 L13.5 20 L16.5 9 L18 13 L22 13"
                    stroke="#38c4e0"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_8px_#2fe08a]" />
              </div>

              <div className="min-w-0 flex-1 pr-6">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-bold tracking-[0.2em] text-ops-cyan uppercase">
                    GREENWAVE PWA
                  </span>
                  <span className="flex items-center gap-1 rounded bg-emerald-400/10 px-1.5 py-0.5 text-[8.5px] font-mono font-semibold text-emerald-300">
                    <Sparkles size={10} /> OFFLINE READY
                  </span>
                </div>
                <h3 className="mt-0.5 text-[15px] font-semibold text-slate-100">
                  Install Local Application
                </h3>
              </div>
            </div>

            <p className="mt-3 text-[12px] leading-relaxed text-slate-400">
              Install GreenWave on your mobile, tablet, or desktop for fast full-screen simulation, touch optimization, and instant emergency response alerts.
            </p>

            {/* Platform instructions */}
            {isIOS ? (
              <div className="mt-4 rounded-xl border border-ops-cyan/20 bg-ops-cyan/[0.04] p-3 text-[11px] text-slate-300 space-y-2">
                <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ops-cyan font-semibold flex items-center gap-1.5">
                  <Tablet size={12} /> iOS & iPadOS Instructions
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/10 text-slate-200">1</span>
                  <span>Tap the <strong>Share</strong> button <Share2 size={13} className="inline text-ops-cyan mx-0.5" /> in Safari's toolbar.</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/10 text-slate-200">2</span>
                  <span>Scroll down and select <strong className="text-emerald-300">"Add to Home Screen"</strong> <PlusSquare size={13} className="inline text-emerald-300 mx-0.5" />.</span>
                </div>
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-400">
                <div className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] p-2">
                  <Smartphone size={14} className="text-ops-cyan shrink-0" />
                  <span>Mobile & Tablet Touch-Optimized</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] p-2">
                  <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
                  <span>Instant Offline Local Engine</span>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="mt-4 flex items-center gap-2.5">
              {!isIOS && canInstall ? (
                <button
                  type="button"
                  onClick={handleInstallClick}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-ops-cyan to-emerald-400 px-4 py-2.5 font-mono text-[12px] font-bold uppercase tracking-[0.08em] text-night-950 shadow-[0_0_20px_rgba(56,196,224,0.35)] transition-transform active:scale-[0.98]"
                >
                  <Download size={15} strokeWidth={2.4} />
                  Install App Now
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-ops-cyan to-emerald-400 px-4 py-2.5 font-mono text-[12px] font-bold uppercase tracking-[0.08em] text-night-950 shadow-[0_0_20px_rgba(56,196,224,0.35)] transition-transform active:scale-[0.98]"
                >
                  <CheckIcon size={14} /> Got It, Thanks
                </button>
              )}

              <button
                type="button"
                onClick={handleClose}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 font-mono text-[11px] font-medium text-slate-400 hover:text-slate-200 hover:bg-white/[0.08] transition-colors"
              >
                Later
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

function CheckIcon({ size }: { size?: number }) {
  return (
    <svg width={size ?? 14} height={size ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
