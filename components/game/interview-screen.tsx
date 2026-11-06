'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SessionView } from '@/lib/game/api'
import type { ClockTiming } from '@/lib/game/clock'
import { visibleLeads } from '@/lib/game/lead-matching'
import { useAskedLeads } from '@/lib/game/use-asked-leads'
import type { useSuspectVoice } from '@/lib/agora/use-suspect-voice'
import { cn } from '@/lib/utils'
import { Eyebrow, StatusDot } from './deco'
import { DetectiveNotebook } from './detective-notebook'
import { InterviewClock } from './session-clock'
import { TapeRecorder } from './tape-recorder'

export type SuspectVoice = ReturnType<typeof useSuspectVoice>

const goldButton = 'min-h-12 rounded-none bg-gold px-5 font-mono text-xs uppercase tracking-widest text-obsidian hover:bg-ivory'
const quietButton = 'min-h-12 rounded-none border border-gold/50 bg-transparent px-4 font-mono text-xs uppercase tracking-widest text-gold hover:bg-gold/10 hover:text-ivory'
const NO_LEADS: SessionView['leads'] = []

/**
 * The interrogation room: the suspect stage takes the width, with the tape recorder (live
 * transcript) over the one notebook on the right on wide screens, and two tabs beneath a
 * fixed-height stage on phones. Everything fits one viewport; the panels scroll inside
 * themselves. Handlers and conditions belong to ProductionSession; this lays them out and
 * reads the captions for the notebook's "asked" marks, which never leave the browser.
 */
export function InterviewScreen({ view, error, busy, timing, voice, onRefresh, onCancelConnection, onRetryConnection, onEndInterview }: {
  view: SessionView | null
  error: string
  busy: boolean
  timing: ClockTiming
  voice: SuspectVoice
  onRefresh: () => void
  onCancelConnection: () => Promise<void>
  onRetryConnection: () => Promise<void>
  onEndInterview: () => Promise<void>
}) {
  const [panel, setPanel] = useState<'notebook' | 'tape'>('notebook')
  const [selectedLead, setSelectedLead] = useState<string | null>(null)
  const leads = view?.leads ?? NO_LEADS
  // The page is cut from the server's list; captions only ever add an "asked" mark to a lead on it.
  const asked = useAskedLeads(voice.transcript, leads)
  const page = useMemo(() => visibleLeads(leads, asked), [leads, asked])
  // The phone tab lights up when the notebook changes while the tape is showing.
  const entries = (view ? view.notebook.length + view.admissions.length : 0) + leads.filter(lead => lead.status === 'answered').length
  const seenEntries = useRef(entries)
  const [unseen, setUnseen] = useState(false)
  useEffect(() => {
    if (panel === 'notebook') { seenEntries.current = entries; setUnseen(false); return }
    if (entries > seenEntries.current) setUnseen(true)
  }, [entries, panel])

  const state = view?.session.state
  const live = ['live','starting_clock','reconnecting'].includes(voice.phase)
  const closed = state === 'ended' || state === 'scored'
  const counting = state === 'active' && !closed
  const line = voice.phase === 'live' ? { tone: 'verdigris' as const, pulse: true, label: 'Live' }
    : voice.phase === 'reconnecting' ? { tone: 'gold' as const, pulse: true, label: 'Reconnecting' }
    : ['error','ended'].includes(voice.phase) ? { tone: closed ? 'muted' as const : 'oxblood' as const, pulse: false, label: closed ? 'Closed' : 'Line down' }
    : { tone: 'gold' as const, pulse: true, label: 'Connecting' }

  return <main className="h-dvh overflow-x-hidden overflow-y-auto bg-obsidian spotlight text-ivory">
    <div className="mx-auto flex h-full w-full max-w-[1440px] flex-col px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
      <header className="flex shrink-0 items-end justify-between gap-4 border-b border-gold/20 pb-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-3"><Link href="/rules" className="label-mono text-gold hover:text-ivory focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold">Rules / New case</Link><Eyebrow className="hidden text-ivory/40 sm:block">Case file</Eyebrow></div>
          {view && <>
            <h1 className="mt-1 truncate font-display text-xl leading-tight sm:text-2xl">{view.briefing.title}</h1>
            <p className="hidden truncate text-sm text-gold sm:block">{view.briefing.publicSuspect.name} · {view.briefing.publicSuspect.role}</p>
          </>}
        </div>
        <InterviewClock timing={timing} counting={counting} closed={closed} />
      </header>
      {error && <div role="alert" className="mt-3 shrink-0 border border-oxblood bg-oxblood/20 p-3 text-sm">{error}<button type="button" onClick={onRefresh} className="ml-3 underline">Retry</button></div>}
      {!view ? <p className="mt-12 label-mono">Opening case file…</p> : <>
        <div className="mt-3 flex flex-1 flex-col gap-3 lg:grid lg:min-h-0 lg:grid-cols-[minmax(0,8fr)_minmax(300px,4fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-4">
          {/* Phones: a 4:3 stage capped at 40dvh leaves room for the notebook beneath. Wide screens: the grid row sets the height. */}
          <section aria-label="Suspect interview" className="relative aspect-[4/3] max-h-[40dvh] w-full shrink-0 overflow-hidden border border-gold/40 bg-obsidian shadow-[0_0_80px_rgba(0,0,0,0.6)] lg:aspect-auto lg:max-h-none lg:min-h-0">
            {/* The SDK inserts its own video element here, so the film and vignette sit on the container and an overlay. */}
            <div ref={voice.videoElement} className="stage-film absolute inset-0" />
            <div className="stage-vignette pointer-events-none absolute inset-0" aria-hidden />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-obsidian/85 via-obsidian/30 via-45% to-transparent" aria-hidden />
            <span className="pointer-events-none absolute inset-1.5 border border-gold/20" aria-hidden />
            <span className="pointer-events-none absolute left-3 top-3 size-4 border-l border-t border-gold/70" aria-hidden />
            <span className="pointer-events-none absolute right-3 top-3 size-4 border-r border-t border-gold/70" aria-hidden />
            <span className="pointer-events-none absolute bottom-3 left-3 size-4 border-b border-l border-gold/70" aria-hidden />
            <span className="pointer-events-none absolute bottom-3 right-3 size-4 border-b border-r border-gold/70" aria-hidden />
            <div className="pointer-events-none absolute left-8 top-7 inline-flex items-center gap-2 border border-gold/30 bg-obsidian/55 px-2.5 py-1.5 backdrop-blur-sm" aria-hidden>
              <StatusDot tone={line.tone} pulse={line.pulse} />
              <span className="label-mono text-ivory/85">{line.label}{live && voice.muted ? ' · Muted' : ''}</span>
            </div>
            {live && <figcaption className="pointer-events-none absolute inset-x-8 bottom-6 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] lg:bottom-7">
              <span className="mb-2 block h-px w-10 bg-gold/70 lg:mb-2.5" aria-hidden />
              <p className="truncate font-display text-xl leading-none text-ivory sm:text-2xl xl:text-3xl">{view.briefing.publicSuspect.name}</p>
              <p className="label-mono mt-1.5 line-clamp-2 text-gold/90 lg:mt-2">{view.briefing.publicSuspect.role}</p>
            </figcaption>}
            {!live && <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-obsidian/70 p-6 text-center">
              <p className="font-display text-3xl">{view.briefing.publicSuspect.name}</p>
              <p className="mt-4 max-w-md text-sm text-ivory/60">{voice.phase === 'connecting' ? 'Opening a secure line…' : voice.phase === 'waiting_media' ? 'Waiting for the suspect’s audio and avatar…' : ['error','ended'].includes(voice.phase) ? 'The line is down.' : 'Opening a secure line…'}</p>
            </div>}
          </section>
          {/* Two tabs on phones. The notebook carries a count and lights up when it changes while the tape is open. */}
          <div role="tablist" aria-label="Interview panels" className="grid shrink-0 grid-cols-2 border border-gold/25 bg-charcoal/40 lg:hidden">
            {([['notebook', `Notebook · ${entries}`], ['tape', 'Tape']] as const).map(([key, label]) => <button key={key} type="button" role="tab" id={`tab-${key}`} aria-selected={panel === key} aria-controls={`interview-${key}`} onClick={() => setPanel(key)} className={cn('label-mono relative min-h-11 truncate px-2 transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ivory', panel === key ? 'bg-gold text-obsidian' : 'text-ivory/70 hover:text-gold')}>
              {panel === key && <span aria-hidden>◆ </span>}{label}
              {key === 'notebook' && unseen && <StatusDot tone="gold" pulse className="absolute right-3 top-1/2 -translate-y-1/2" />}
              {key === 'notebook' && unseen && <span className="sr-only">, updated</span>}
            </button>)}
          </div>
          {/* Right column. On phones the wrapper contributes nothing (contents) and each panel is its own tab; on lg the
              deck takes a fixed share of the column so the transcript stays near the top and the notebook fills the rest.
              Below lg a panel contributes only its floor to the column's minimum height (contain-size), so a short viewport
              such as a landscape phone scrolls the room instead of crushing the panel, while a tall one never stretches. */}
          <div className="contents lg:flex lg:min-h-0 lg:flex-col lg:gap-3">
            <TapeRecorder id="interview-tape" lines={voice.transcript} status={voice.transcriptStatus} suspectName={view.briefing.publicSuspect.name} running={voice.phase === 'live'} closed={closed} timing={timing} className={cn('min-h-64 flex-1 contain-size lg:h-[clamp(13rem,30dvh,19rem)] lg:min-h-0 lg:flex-none lg:contain-none', panel === 'tape' ? 'flex' : 'hidden lg:flex')} />
            <DetectiveNotebook id="interview-notebook" leads={page} asked={asked} admissions={view.admissions} records={view.notebook} suspectName={view.briefing.publicSuspect.name} selectedLead={selectedLead} onSelectLead={id => setSelectedLead(current => current === id ? null : id)} onRefresh={onRefresh} className={cn('min-h-64 flex-1 contain-size lg:min-h-0 lg:contain-none', panel === 'notebook' ? 'flex' : 'hidden lg:flex')} />
          </div>
        </div>
        <footer className="mt-3 flex shrink-0 flex-col gap-2 border-t border-gold/20 pt-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1">
            <p role="status" className="flex items-center gap-2 text-xs text-gold sm:text-sm"><StatusDot tone={line.tone} pulse={line.pulse} className="shrink-0" />{voice.phase === 'live' ? 'Connected · Your microphone is live' : voice.phase === 'starting_clock' ? 'Suspect connected · Confirming the clock…' : voice.phase === 'reconnecting' ? 'Reconnecting · The interview clock continues' : view.session.state === 'ended' || view.session.state === 'scored' ? 'Interview closed' : 'Your clock starts after audio and video connect.'}</p>
            {voice.error && <p role="alert" className="mt-1 text-xs text-ivory sm:text-sm">{voice.error}</p>}
          </div>
          {/* On phones every action shares the row equally and labels shorten, so error states stay two rows at most. */}
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {voice.audioBlocked && <Button className={cn(goldButton, 'flex-1 sm:flex-none')} onClick={voice.resumeAudio}><span className="sm:hidden">Enable audio</span><span className="hidden sm:inline">Enable suspect audio</span></Button>}
            {['connecting','waiting_media'].includes(voice.phase) && <button type="button" className="min-h-11 flex-1 px-2 text-center text-sm text-ivory/70 underline underline-offset-4 hover:text-ivory focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:flex-none" onClick={onCancelConnection}>Cancel connection</button>}
            {view.session.state === 'abandoned' && <Link className={cn(quietButton, 'inline-flex flex-1 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:flex-none')} href="/rules"><span className="sm:hidden">New case</span><span className="hidden sm:inline">Request another case</span></Link>}
            {['created','preparing','active'].includes(view.session.state) && ['error','ended'].includes(voice.phase) && <Button className={cn(goldButton, 'flex-1 sm:flex-none')} disabled={busy} onClick={onRetryConnection}><span className="sm:hidden">{view.session.state === 'active' ? 'Reconnect' : 'Retry'}</span><span className="hidden sm:inline">{view.session.state === 'active' ? 'Reconnect interview' : 'Retry connection'}</span></Button>}
            {live && <Button className={cn(quietButton, 'w-12 px-0 sm:w-auto sm:px-4', voice.muted && 'border-gold bg-gold/15 text-ivory')} aria-pressed={voice.muted} aria-label={voice.muted ? 'Unmute microphone' : 'Mute microphone'} onClick={() => void voice.toggleMute()}>{voice.muted ? <MicOff className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />}<span className="hidden sm:inline">{voice.muted ? 'Unmute microphone' : 'Mute microphone'}</span></Button>}
            <Button className={cn(goldButton, 'flex-1 sm:flex-none')} disabled={busy || !['active','ended','scored'].includes(view.session.state)} onClick={onEndInterview}><span className="sm:hidden">End interview</span><span className="hidden sm:inline">End interview and file verdict</span></Button>
          </div>
        </footer>
      </>}
    </div>
  </main>
}
