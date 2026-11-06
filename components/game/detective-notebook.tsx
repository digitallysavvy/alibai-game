'use client'

import { useState } from 'react'
import type { Lead, PublicEvidence, RecordedFact } from '@/lib/game/api'
import { cn } from '@/lib/utils'

/** Open, asked or answered: the server decides open and answered, the captions only ever add "asked". */
export type LeadState = 'open' | 'asked' | 'answered'
export const leadState = (lead: Lead, asked: ReadonlySet<string>): LeadState => lead.status === 'answered' ? 'answered' : asked.has(lead.id) ? 'asked' : 'open'

function Quote({ fact, suspectName, animate }: { fact: RecordedFact; suspectName: string; animate: boolean }) {
  return <blockquote className={cn('mt-2.5 border-l-2 border-gold/60 pl-3', animate && 'animate-reveal motion-reduce:animate-none')}>
    <p className="font-display text-[0.9375rem] italic leading-snug text-ivory">“{fact.statement}”</p>
    <footer className="label-mono mt-1.5 text-gold/70">— {suspectName}</footer>
  </blockquote>
}

function LeadCard({ lead, index, state, selected, suspectName, animate, onSelect }: {
  lead: Lead; index: number; state: LeadState; selected: boolean; suspectName: string; animate: boolean; onSelect: (id: string) => void
}) {
  const number = <span className={cn('font-mono text-[0.625rem] leading-5 tabular-nums', state === 'open' && !selected ? 'text-ivory/40' : 'text-gold')} aria-hidden>{String(index + 1).padStart(2, '0')}</span>
  if (state === 'answered') return <li className={cn('relative border border-gold/60 bg-gold/8 p-3', animate && 'animate-lead-flash motion-reduce:animate-none')}>
    <div className="flex gap-3">
      {number}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm leading-snug text-ivory/80 line-through decoration-gold/50 decoration-1">{lead.text}</p>
          <span className={cn('label-mono shrink-0 border border-gold px-1.5 py-0.5 text-gold', animate && 'animate-stamp motion-reduce:animate-none')} style={{ transform: 'rotate(-6deg)' }}>Answered</span>
        </div>
        {lead.facts.map(fact => <Quote key={fact.id} fact={fact} suspectName={suspectName} animate={animate} />)}
      </div>
    </div>
  </li>
  return <li className={cn(animate && 'animate-reveal motion-reduce:animate-none')}>
    <button type="button" aria-pressed={selected} onClick={() => onSelect(lead.id)} className={cn(
      'flex min-h-14 w-full gap-3 border p-3 text-left text-sm leading-snug transition-colors duration-200 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
      selected ? 'border-gold bg-gold/15 text-ivory' : state === 'asked' ? 'border-gold/40 bg-obsidian/40 text-ivory/70 hover:border-gold/60' : 'border-ivory/20 bg-obsidian/60 text-ivory/85 hover:border-gold/60 hover:bg-charcoal/60',
    )}>
      {number}
      <span className="min-w-0 flex-1">
        {lead.text}
        {state === 'asked' && <span className="label-mono mt-2 flex items-center gap-1.5 text-gold/70"><span className="inline-block size-1.5 rotate-45 border border-gold/70" aria-hidden />Asked · press again</span>}
        {state === 'open' && selected && <span className="label-mono mt-2 block text-gold">◆ Say this aloud</span>}
      </span>
    </button>
  </li>
}

/**
 * One notebook for the whole interview. Leads are the questions worth asking: they are marked
 * asked from the captions, answered by the server once a fact is on record, and each answer is
 * written beneath its lead in the suspect's words. New follow-ups appear as facts unlock them.
 * Evidence records sit beneath. Tapping a lead only highlights it; nothing is sent.
 */
export function DetectiveNotebook({ leads, asked, admissions, records, suspectName, selectedLead, onSelectLead, onRefresh, id, className }: {
  leads: Lead[]
  asked: ReadonlySet<string>
  admissions: RecordedFact[]
  records: PublicEvidence[]
  suspectName: string
  selectedLead: string | null
  onSelectLead: (id: string) => void
  onRefresh: () => void
  id?: string
  className?: string
}) {
  // Whatever is on the page at first paint sits still; only an item that arrives or changes state afterwards moves.
  const keyOf = (lead: Lead) => `${lead.id}:${leadState(lead, asked)}`
  const [initial] = useState(() => new Set([...leads.map(keyOf), ...admissions.map(fact => fact.id), ...records.map(item => item.id)]))
  const fresh = (key: string) => !initial.has(key)
  // What to ask next stays at the top; a lead that gets answered drops into the record beneath, stamped.
  const pending = leads.filter(lead => lead.status !== 'answered'), closed = leads.filter(lead => lead.status === 'answered')
  const ordered = [...pending, ...closed]
  const summary = `${pending.length} open · ${closed.length + admissions.length} answered`

  return <section id={id} aria-labelledby="notebook-heading" className={cn('flex-col border border-gold/25 bg-charcoal/30', className)}>
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gold/20 px-4 py-2">
      <div className="min-w-0">
        <h2 id="notebook-heading" className="font-display text-lg leading-tight text-ivory xl:text-xl">Detective’s Notebook</h2>
        <p className="label-mono mt-0.5 truncate text-ivory/50" aria-live="polite">{summary}</p>
      </div>
      <button type="button" onClick={onRefresh} className="min-h-11 shrink-0 px-2 text-sm text-gold underline underline-offset-4 hover:text-ivory focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold" aria-label="Refresh notebook">Refresh</button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
      <h3 className="label-mono mb-2 flex items-center justify-between text-gold/80"><span>Leads</span><span className="text-ivory/40">Say one aloud</span></h3>
      {leads.length === 0
        ? <p className="px-1 py-4 text-center text-sm leading-relaxed text-ivory/50">Every lead is closed. End the interview when you are ready to file.</p>
        : <ol className="flex flex-col gap-2.5">{ordered.map((lead, index) => {
          const state = leadState(lead, asked), key = keyOf(lead)
          // A new key remounts the card, which is what restarts its entrance or stamp animation.
          return <LeadCard key={key} lead={lead} index={index} state={state} selected={state === 'open' && selectedLead === lead.id} suspectName={suspectName} animate={fresh(key)} onSelect={onSelectLead} />
        })}</ol>}
      {admissions.length > 0 && <ul className="mt-2.5 flex flex-col gap-2.5">{admissions.map(fact => <li key={fact.id} className={cn('border border-gold/60 bg-gold/8 p-3', fresh(fact.id) && 'animate-lead-flash motion-reduce:animate-none')}>
        <p className="label-mono text-gold/70">Volunteered without being asked</p>
        <Quote fact={fact} suspectName={suspectName} animate={fresh(fact.id)} />
      </li>)}</ul>}
      <h3 className="label-mono mb-2 mt-5 flex items-center justify-between text-gold/80"><span>On record</span><span className="text-ivory/40">{records.length === 1 ? '1 entry' : `${records.length} entries`}</span></h3>
      {records.length === 0
        ? <p className="px-1 py-4 text-center text-sm leading-relaxed text-ivory/50">Nothing on record yet. Facts the suspect confirms aloud unlock entries here.</p>
        : <ol className="flex flex-col gap-2.5">{records.map((item, index) => <li key={item.id} className={cn('border border-gold/20 bg-obsidian/60 p-3', fresh(item.id) && 'animate-reveal motion-reduce:animate-none')}>
          <div className="flex items-center justify-between gap-3">
            <p className="label-mono text-gold/70">{item.kind === 'character_claim' ? 'Character claim' : 'Recorded observation'}</p>
            <span className="font-mono text-[0.625rem] tabular-nums text-ivory/40" aria-label={`Entry ${index + 1}`}>№ {String(index + 1).padStart(2, '0')}</span>
          </div>
          <h4 className="mt-1.5 font-display text-base leading-snug text-ivory">{item.title}</h4>
          <p className="mt-1.5 text-sm leading-relaxed text-ivory/75">{item.description}</p>
          <p className="mt-2 text-xs text-ivory/45">Source: {item.source}</p>
        </li>)}</ol>}
    </div>
  </section>
}
