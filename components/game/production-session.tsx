'use client'

import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { gameRequest, sessionRequest, type PublicEvidence, type SessionView } from '@/lib/game/api'
import { DecoRule, Eyebrow } from './deco'
import { InterviewScreen } from './interview-screen'
import { SessionClock } from './session-clock'
import { useSuspectVoice } from '@/lib/agora/use-suspect-voice'
import { secondsLeft, startCountdown } from '@/lib/game/clock'

const buttonClass = 'min-h-12 rounded-none bg-gold px-6 font-mono text-xs uppercase tracking-widest text-obsidian hover:bg-ivory'

function EvidenceList({ items }: { items: PublicEvidence[] }) {
  return <ul className="mt-4 grid gap-3 sm:grid-cols-2">{items.map(item => <li key={item.id} className="border border-gold/25 bg-charcoal/30 p-4">
    <p className="label-mono text-gold/70">{item.kind === 'character_claim' ? 'Character claim' : 'Recorded observation'}</p>
    <h3 className="mt-2 font-display text-xl text-ivory">{item.title}</h3>
    <p className="mt-2 text-sm leading-relaxed text-ivory/75">{item.description}</p>
    <p className="mt-3 text-xs text-ivory/45">Source: {item.source}</p>
  </li>)}</ul>
}

export function ProductionSession({ sessionId, mode }: { sessionId: string; mode: 'briefing' | 'interview' | 'verdict' | 'results' }) {
  const router = useRouter()
  const [view, setView] = useState<SessionView | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [decision, setDecision] = useState<'guilty' | 'innocent' | null>(null)
  const [evidenceIds, setEvidenceIds] = useState<string[]>([])
  const [reasoning, setReasoning] = useState('')
  const [clockOffset, setClockOffset] = useState(0)
  const syncingFacts = useRef(false)
  const autoConnected = useRef(false)
  const autoEnded = useRef(false)
  const applyView = useCallback((data: SessionView) => {
    // A read that was in flight when the clock started must not undo it.
    setView(current => current?.session.started_at && !data.session.started_at ? current : data)
    setClockOffset(Date.parse(data.serverTime) - Date.now())
  }, [])
  const refresh = useCallback(async () => {
    try {
      const data = await sessionRequest<SessionView>(sessionId, 'read')
      applyView(data); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open the case.') }
  }, [sessionId, applyView])
  const voice = useSuspectVoice(sessionId, applyView, refresh)
  useEffect(() => {
    if(mode !== 'interview' || view?.session.state !== 'active' || voice.phase !== 'live') return
    let stopped = false
    const sync = async () => {
      if(syncingFacts.current) return
      syncingFacts.current = true
      try {
        const data = await sessionRequest<SessionView>(sessionId,'sync-facts',{})
        if(!stopped) applyView(data)
      } catch { /* Media continues; the next authenticated provider sync can retry. */ }
      finally { syncingFacts.current = false }
    }
    void sync()
    const timer = window.setInterval(() => void sync(), 5000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [mode,view?.session.state,voice.phase,sessionId,applyView])

  useEffect(() => { void refresh() }, [refresh])
  // Caches the SDK for the room. An import only: no client, no microphone, nothing billable.
  useEffect(() => { if(mode === 'briefing') void import('agora-rtc-sdk-ng').catch(() => {}) }, [mode])
  useEffect(() => {
    let closed = false
    let dispose: (() => void) | undefined
    void gameRequest<{url:string;key:string;accessToken:string}>('/api/realtime-auth').then(async config => {
      if (closed) return
      const client = createClient(config.url, config.key, { auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false } })
      await client.realtime.setAuth(config.accessToken)
      if (closed) { await client.removeAllChannels(); return }
      const channel = client.channel(`notebook-${sessionId}`).on('postgres_changes', {
        event:'INSERT',schema:'public',table:'session_updates',filter:`session_id=eq.${sessionId}`,
      }, () => { void refresh() }).subscribe()
      dispose = () => { void client.removeChannel(channel) }
    }).catch(() => { /* Explicit refresh remains available on connection failure. */ })
    return () => { closed = true; dispose?.() }
  }, [refresh, sessionId])
  useEffect(() => {
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  async function action(actionName: string, body: unknown = {}) {
    setBusy(true); setError('')
    try {
      // The end response is a full view. A verdict response is not, so that one re-reads.
      if(actionName === 'end') applyView(await voice.endSession())
      else { await sessionRequest(sessionId, actionName, body); await refresh() }
      return true
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Request failed.'); return false }
    finally { setBusy(false) }
  }
  const started = view?.session.started_at ? Date.parse(view.session.started_at) : null
  const ended = view?.session.ended_at ? Date.parse(view.session.ended_at) : null
  const timing = { startedAt: started, endedAt: ended, clockOffset }
  useEffect(() => {
    if(mode !== 'interview' || view?.session.state !== 'active' || started === null) return
    return startCountdown({ startedAt: started, clockOffset, onExpire: () => {
      if(autoEnded.current) return
      autoEnded.current = true
      void voice.disconnect()
      void voice.endSession().then(data => { applyView(data); setError('') }).catch(() => { autoEnded.current = false; setError('The interview has ended. Please retry filing your verdict.') })
    } })
  }, [mode, view?.session.state, started, clockOffset, applyView, voice.disconnect, voice.endSession])
  // Connects once the first read shows a session that can. Failures fall back to the retry button.
  useEffect(() => {
    const state = view?.session.state
    if(mode !== 'interview' || autoConnected.current || voice.phase !== 'idle' || secondsLeft({ startedAt: started, endedAt: ended, clockOffset }, Date.now()) <= 0) return
    if(!state || !['created','preparing','active'].includes(state)) return
    // Deferred so React's development double mount can't cancel the only attempt.
    const timer = window.setTimeout(() => { autoConnected.current = true; void voice.start() }, 0)
    return () => window.clearTimeout(timer)
  }, [mode, view?.session.state, voice.phase, voice.start, started, ended, clockOffset])

  // The room has its own one-viewport layout; the handlers stay here so the dossier pages share them.
  if (mode === 'interview') return <InterviewScreen view={view} error={error} busy={busy} timing={timing} voice={voice} onRefresh={() => void refresh()}
    onCancelConnection={async()=>{await voice.disconnect();await action('end')}}
    onRetryConnection={async () => { await voice.disconnect(); await voice.start() }}
    onEndInterview={async () => { if(!view) return; if(view.session.state === 'scored') router.push(`/game/${sessionId}/results`); else if(view.session.state === 'ended' || await action('end')) { await voice.disconnect(); router.push(`/game/${sessionId}/verdict`) } }} />

  return <main className="min-h-dvh bg-obsidian spotlight px-5 pb-16 pt-6 text-ivory">
    <div className="mx-auto max-w-3xl">
      <header className="flex items-center justify-between gap-4"><Link href="/rules" className="label-mono text-gold">Rules / New case</Link><SessionClock timing={timing} className="font-mono text-sm text-gold" /></header>
      {error && <div role="alert" className="mt-6 border border-oxblood bg-oxblood/20 p-4 text-sm">{error}<button type="button" onClick={() => void refresh()} className="ml-3 underline">Retry</button></div>}
      {!view ? <p className="mt-12 label-mono">Opening case file…</p> : <>
        <Eyebrow className="mt-10">{mode === 'results' ? 'Case resolution' : mode === 'verdict' ? 'Detective’s report' : 'Case file'}</Eyebrow>
        <h1 className="mt-3 font-display text-4xl md:text-5xl">{view.briefing.title}</h1>
        <p className="mt-3 text-gold">{view.briefing.publicSuspect.name} · {view.briefing.publicSuspect.role}</p>
        <DecoRule className="my-7" />
        {mode === 'briefing' && <>
          <article className="deco-frame bg-charcoal/20 p-5"><h2 className="label-mono text-gold">Public briefing</h2><p className="mt-4 text-base leading-relaxed text-ivory/85">{view.briefing.publicBriefing}</p><p className="mt-5 text-sm text-ivory/65">{view.briefing.publicSuspect.relationship}</p></article>
          <h2 className="mt-8 font-display text-2xl">Evidence on file</h2><EvidenceList items={view.briefing.publicEvidence} />
          <p className="mt-6 text-sm text-ivory/55">Your three-minute clock begins only when the interview starts.</p>
          <Button className={`${buttonClass} mt-5`} onClick={() => router.push(`/game/${sessionId}`)}>Enter interrogation room</Button>
        </>}
        {mode === 'verdict' && <>
          {view.session.state === 'scored' ? <Link className="text-gold underline" href={`/game/${sessionId}/results`}>Your verdict is locked. View results.</Link> : !['ended','active'].includes(view.session.state) ? <p>The interrogation has not started. <Link className="text-gold underline" href={`/game/${sessionId}`}>Return to the room.</Link></p> : <>
            <h2 className="font-display text-2xl">Did this suspect commit the reported crime?</h2>
            <fieldset className="mt-5 grid grid-cols-2 gap-3"><legend className="sr-only">Verdict</legend>{(['guilty','innocent'] as const).map(value => <label key={value} className={`cursor-pointer border p-5 text-center ${decision === value ? 'border-gold bg-gold/15' : 'border-ivory/25'}`}><input type="radio" name="verdict" value={value} checked={decision === value} onChange={() => setDecision(value)} className="mr-3" /><span className="font-display text-2xl capitalize">{value}</span></label>)}</fieldset>
            <h2 className="mt-8 font-display text-2xl">Supporting evidence</h2><p className="mt-2 text-sm text-ivory/55">Select evidence that supports your conclusion.</p>
            <div className="mt-4 flex flex-col gap-3">{view.notebook.map(item => <label key={item.id} className="flex gap-3 border border-ivory/20 p-4"><input type="checkbox" checked={evidenceIds.includes(item.id)} onChange={() => setEvidenceIds(ids => ids.includes(item.id) ? ids.filter(id => id !== item.id) : [...ids,item.id])} /><span><strong>{item.title}</strong><span className="mt-1 block text-sm text-ivory/65">{item.description}</span></span></label>)}</div>
            <label className="mt-8 block">Reasoning (optional)<textarea maxLength={2000} rows={4} value={reasoning} onChange={e => setReasoning(e.target.value)} className="mt-3 w-full border border-gold/30 bg-charcoal/30 p-3" /></label>
            <p className="mt-4 text-xs text-ivory/50">Once filed, your verdict is final. Scores use the server’s clock and verified evidence.</p>
            <Button className={`${buttonClass} mt-6`} disabled={!decision || busy} onClick={async () => { if(view.session.state === 'active' && !await action('end')) return; if(await action('verdict',{verdict:decision,evidenceIds,reasoning})) router.push(`/game/${sessionId}/results`) }}>{busy ? 'Filing report…' : 'Submit final verdict'}</Button>
          </>}
        </>}
        {mode === 'results' && (view.results ? <>
          <p className="font-display text-3xl">The suspect was <strong>{view.results.correctVerdict}</strong>.</p>
          <p className="mt-8 font-mono text-7xl text-gold">{view.results.score.total}<span className="text-xl text-ivory/40"> / 1,000</span></p>
          <dl className="mt-8 grid grid-cols-2 gap-px border border-gold/20 bg-gold/20 sm:grid-cols-4">{[
            ['Verdict',view.results.score.verdict_points,500],['Evidence',view.results.score.evidence_points,300],['Facts',view.results.score.fact_points,150],['Time',view.results.score.time_points,50]
          ].map(([label,value,max]) => <div key={label} className="bg-obsidian p-4"><dt className="text-xs text-ivory/55">{label}</dt><dd className="mt-2 font-mono">{value} / {max}</dd></div>)}</dl>
          <section className="deco-frame mt-8 p-5"><h2 className="font-display text-2xl">What actually happened</h2><p className="mt-4 leading-relaxed text-ivory/80">{view.results.explanation}</p></section>
          <h2 className="mt-8 font-display text-2xl">Evidence you cited</h2><EvidenceList items={view.results.citedEvidence} />
          <h2 className="mt-8 font-display text-2xl">Important clues you missed</h2><EvidenceList items={view.results.missedImportantClues.map(clue => clue.evidence)} />
          <div className="mt-8 flex gap-6"><Link className="text-gold underline" href="/rules">Take a new case</Link><Link className="text-gold underline" href="/leaderboard?fresh=1">Leaderboard</Link></div>
        </> : <p>File a verdict before opening the sealed case truth. <Link className="text-gold underline" href={`/game/${sessionId}/verdict`}>Open verdict form</Link></p>)}
      </>}
    </div>
  </main>
}
