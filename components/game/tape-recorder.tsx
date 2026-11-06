'use client'

import { useEffect, useRef } from 'react'
import type { TranscriptLine, TranscriptStatus } from '@/lib/agora/live-transcript'
import type { ClockTiming } from '@/lib/game/clock'
import { cn } from '@/lib/utils'
import { useSecondsLeft } from './session-clock'

const INTERVIEW_SECONDS = 180

// Deck geometry in SVG user units. Reels sit above a head block; the tape runs under both reels.
const VIEW = { width: 320, height: 124 }
const REEL = { y: 50, left: 72, right: 248, flange: 42, packMin: 14, packMax: 36, hub: 10 }
const HEAD = { x: 132, y: 92, width: 56, height: 22 }
const ROLLER = { leftX: 118, rightX: 202, y: 97, radius: 5 }

/** Point where a straight tape run from `point` would leave the pack, on the reel's underside. */
function tangentPoint(cx: number, cy: number, radius: number, point: { x: number; y: number }) {
  const dx = point.x - cx, dy = point.y - cy
  const distance = Math.hypot(dx, dy)
  const base = Math.atan2(dy, dx), spread = Math.acos(Math.min(1, radius / distance))
  const candidates = [base + spread, base - spread].map(angle => ({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) }))
  return candidates[0].y >= candidates[1].y ? candidates[0] : candidates[1]
}

function Reel({ cx, pack, running, duration }: { cx: number; pack: number; running: boolean; duration: string }) {
  const cy = REEL.y
  return <g>
    <circle cx={cx} cy={cy} r={REEL.flange} className="fill-obsidian" />
    {/* The wound tape. Its radius is the one part of the deck that changes with the clock. */}
    <circle cx={cx} cy={cy} r={pack} fill="#2b2320" stroke="#3d322c" strokeWidth="1" />
    {pack > REEL.packMin + 6 && <circle cx={cx} cy={cy} r={(pack + REEL.packMin) / 2} fill="none" stroke="#1a1512" strokeWidth="0.75" opacity="0.8" />}
    {/* Flange, spokes and hub turn together; the animation only pauses so the reel never snaps back. */}
    <g className="animate-reel-spin motion-reduce:[animation:none]" style={{ transformOrigin: `${cx}px ${cy}px`, animationDuration: duration, animationPlayState: running ? 'running' : 'paused' }}>
      <circle cx={cx} cy={cy} r={REEL.flange} fill="none" className="stroke-gold/45" strokeWidth="1.25" />
      <circle cx={cx} cy={cy} r={REEL.flange - 4} fill="none" className="stroke-gold/15" strokeWidth="0.75" />
      {[0, 120, 240].map(angle => <path key={angle} d={`M${cx - 3} ${cy - REEL.hub + 1} L${cx - 5.5} ${cy - REEL.flange + 2} L${cx + 5.5} ${cy - REEL.flange + 2} L${cx + 3} ${cy - REEL.hub + 1} Z`} transform={`rotate(${angle} ${cx} ${cy})`} className="fill-gold/55" />)}
      <circle cx={cx} cy={cy} r={REEL.hub} className="fill-charcoal stroke-gold/70" strokeWidth="1" />
      <circle cx={cx} cy={cy} r={3} className="fill-gold/80" />
    </g>
  </g>
}

/**
 * The live transcript as a reel-to-reel deck. Display only: evidence in the notebook comes from
 * the server, never from these lines. Everything the deck shows is real state. Reels turn only
 * while the line is live, the lamp follows the line, and tape winds from the supply reel to the
 * take-up reel as the three-minute clock runs down.
 */
export function TapeRecorder({ lines, status, suspectName, running, closed, timing, id, className }: {
  lines: TranscriptLine[]
  status: TranscriptStatus
  suspectName: string
  /** The line is live, so the reels turn. */
  running: boolean
  /** The interview is over. */
  closed: boolean
  /** Drives the reels and counter; the deck re-renders on its own once a second. */
  timing: ClockTiming
  id?: string
  className?: string
}) {
  const log = useRef<HTMLDivElement | null>(null)
  useEffect(() => { if(log.current) log.current.scrollTop = log.current.scrollHeight }, [lines])
  const left = useSecondsLeft(timing)
  const elapsed = Math.min(INTERVIEW_SECONDS, Math.max(0, INTERVIEW_SECONDS - left))
  const used = elapsed / INTERVIEW_SECONDS
  const supply = REEL.packMax - (REEL.packMax - REEL.packMin) * used
  const takeUp = REEL.packMin + (REEL.packMax - REEL.packMin) * used
  const leftRoller = { x: ROLLER.leftX, y: ROLLER.y - ROLLER.radius }
  const rightRoller = { x: ROLLER.rightX, y: ROLLER.y - ROLLER.radius }
  const offSupply = tangentPoint(REEL.left, REEL.y, supply, leftRoller)
  const ontoTakeUp = tangentPoint(REEL.right, REEL.y, takeUp, rightRoller)
  const tape = `M${offSupply.x.toFixed(1)} ${offSupply.y.toFixed(1)} L${leftRoller.x} ${leftRoller.y} L${rightRoller.x} ${rightRoller.y} L${ontoTakeUp.x.toFixed(1)} ${ontoTakeUp.y.toFixed(1)}`
  const lamp = running ? 'Recording' : closed ? 'Stopped' : 'Standby'
  const note = status === 'unavailable' ? 'The live transcript is unavailable. Your voice interview is not affected.'
    : lines.length > 0 ? '' : status === 'live' ? 'Listening for the first words…' : 'The transcript appears here while the line is open.'

  return <section id={id} aria-labelledby="tape-heading" className={cn('flex-col border border-gold/25 bg-charcoal/30', className)}>
    <div className="flex shrink-0 flex-col bg-[linear-gradient(180deg,rgba(36,38,42,0.9),rgba(16,17,19,0.6))] px-3 pt-2.5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('relative inline-flex size-2.5 shrink-0 rounded-full border border-ivory/20', running ? 'bg-oxblood shadow-[0_0_10px_2px_rgba(113,47,56,0.85)]' : 'bg-oxblood/30')} aria-hidden>
            {running && <span className="absolute inset-0 rounded-full bg-oxblood animate-pulse motion-reduce:animate-none" />}
          </span>
          {/* Under 360px the lamp alone carries the state; the word would otherwise truncate beside the counter. */}
          <h2 id="tape-heading" className="label-mono truncate text-ivory/85">Transcript<span className={cn('hidden min-[360px]:inline', running ? 'text-gold' : 'text-ivory/45')}> · {lamp}</span></h2>
        </div>
        <div className="flex shrink-0 items-center gap-px" aria-hidden>
          {String(elapsed).padStart(4, '0').split('').map((digit, index) => <span key={index} className="inline-flex h-5 w-3.5 items-center justify-center border border-gold/20 bg-obsidian font-mono text-[0.6875rem] tabular-nums leading-none text-ivory/80">{digit}</span>)}
        </div>
      </header>
      <svg viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} className="mt-1 h-auto max-h-[clamp(4rem,11dvh,6rem)] w-full text-gold lg:max-h-[clamp(5.5rem,14dvh,8rem)]" aria-hidden focusable="false">
        <Reel cx={REEL.left} pack={supply} running={running} duration="1.7s" />
        <Reel cx={REEL.right} pack={takeUp} running={running} duration="2.3s" />
        {/* Head block and guide rollers; the tape passes in front of them. */}
        <rect x={HEAD.x} y={HEAD.y} width={HEAD.width} height={HEAD.height} className="fill-charcoal stroke-gold/35" strokeWidth="1" />
        {[0, 1, 2].map(index => <rect key={index} x={HEAD.x + 8 + index * 15} y={HEAD.y - 3} width="10" height="8" className="fill-obsidian stroke-gold/50" strokeWidth="0.75" />)}
        <line x1={HEAD.x + 6} y1={HEAD.y + HEAD.height - 6} x2={HEAD.x + HEAD.width - 6} y2={HEAD.y + HEAD.height - 6} className="stroke-gold/25" strokeWidth="0.75" />
        <path d={tape} fill="none" stroke="#3d322c" strokeWidth="2.5" strokeLinejoin="round" />
        <path d={tape} fill="none" stroke="#5a4a3f" strokeWidth="0.75" strokeLinejoin="round" opacity="0.7" />
        {[ROLLER.leftX, ROLLER.rightX].map(x => <g key={x}><circle cx={x} cy={ROLLER.y} r={ROLLER.radius} className="fill-obsidian stroke-gold/60" strokeWidth="1" /><circle cx={x} cy={ROLLER.y} r={1.5} className="fill-gold/70" /></g>)}
        <line x1="8" y1={VIEW.height - 1} x2={VIEW.width - 8} y2={VIEW.height - 1} className="stroke-gold/20" strokeWidth="1" />
      </svg>
    </div>
    {/* The inset window. Real text at a comfortable size; the deck above is only chrome. The note fills the window
        while it is empty and becomes a footer once lines exist, since the link can fail after lines have arrived. */}
    <div className="mx-3 mt-1 flex min-h-0 flex-1 flex-col border border-gold/20 bg-obsidian/85 shadow-[inset_0_2px_12px_rgba(0,0,0,0.6)]">
      <div ref={log} role="log" aria-label="Interview transcript" tabIndex={0} className={cn('min-h-0 overflow-y-auto overscroll-contain px-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold', lines.length > 0 ? 'flex-1 py-2.5' : 'flex-none')}>
        {lines.length > 0 && <div className="flex flex-col gap-2.5">{lines.map(line => <p key={line.id} className="text-sm leading-relaxed">
          <span className={cn('mr-2 font-mono text-[0.625rem] uppercase tracking-widest', line.speaker === 'suspect' ? 'text-gold' : 'text-ivory/55')}>{line.speaker === 'suspect' ? suspectName : 'You'}</span>
          <span className="text-ivory/90">{line.text}</span>
        </p>)}</div>}
      </div>
      {note && <p role="status" className={cn('text-ivory/60', lines.length > 0 ? 'shrink-0 border-t border-gold/20 px-3 py-1.5 text-xs leading-snug' : 'flex flex-1 items-center justify-center p-4 text-center text-sm leading-relaxed')}>{note}</p>}
    </div>
    <p className="shrink-0 px-3 py-2 text-xs text-ivory/50">Reference only. Evidence is verified in the notebook.</p>
  </section>
}
