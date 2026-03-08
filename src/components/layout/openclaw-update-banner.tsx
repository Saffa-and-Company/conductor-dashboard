'use client'

import { useState } from 'react'
import { useMissionControl } from '@/store'
import { Button } from '@/components/ui/button'

export function OpenClawUpdateBanner() {
  const { openclawUpdate, openclawUpdateDismissedVersion, dismissOpenclawUpdate } = useMissionControl()
  const [copied, setCopied] = useState(false)

  if (!openclawUpdate) return null
  if (openclawUpdateDismissedVersion === openclawUpdate.latest) return null

  function handleCopy() {
    navigator.clipboard.writeText(openclawUpdate!.updateCommand).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <div className="mx-4 mt-3 mb-0 flex items-center gap-3 px-4 py-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-sm">
      <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 shrink-0" />
      <p className="flex-1 text-xs text-cyan-300">
        <span className="font-medium text-cyan-200">
          OpenClaw update: v{openclawUpdate.latest} available
        </span>
        {' (installed: v'}{openclawUpdate.installed}{')'}
      </p>
      <button
        onClick={handleCopy}
        className="shrink-0 text-2xs font-medium text-cyan-900 bg-cyan-500 hover:bg-cyan-400 px-2.5 py-1 rounded transition-colors"
      >
        {copied ? 'Copied!' : 'Copy Command'}
      </button>
      <a
        href={openclawUpdate.releaseUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 text-2xs font-medium text-cyan-400 hover:text-cyan-300 px-2 py-1 rounded border border-cyan-500/20 hover:border-cyan-500/40 transition-colors"
      >
        View Release
      </a>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => dismissOpenclawUpdate(openclawUpdate.latest)}
        className="shrink-0 text-cyan-400/60 hover:text-cyan-300 hover:bg-transparent"
        title="Dismiss"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </Button>
    </div>
  )
}
