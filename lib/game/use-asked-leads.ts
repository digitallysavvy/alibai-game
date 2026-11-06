'use client'

import { useEffect, useRef, useState } from 'react'
import type { TranscriptLine } from '@/lib/agora/live-transcript'
import type { Lead } from '@/lib/game/api'
import { matchLead, visibleLeads } from './lead-matching'

const NONE: ReadonlySet<string> = new Set()

/**
 * Reads each finished player caption once and marks the lead it asked, comparing only with the
 * open leads on the page at that moment. Browser only and display only: the set it returns is
 * never sent anywhere, and the server's open/answered status always wins over it. If captions
 * fail nothing here runs, and the game plays on with every lead open.
 */
export function useAskedLeads(transcript: readonly TranscriptLine[], leads: readonly Lead[]): ReadonlySet<string> {
  const [asked, setAsked] = useState<ReadonlySet<string>>(NONE)
  const read = useRef(new Set<string>())
  useEffect(() => {
    const finished = transcript.filter(line => line.speaker === 'detective' && line.final && !read.current.has(line.id))
    if (!finished.length) return
    for (const line of finished) read.current.add(line.id)
    setAsked(previous => {
      const next = new Set(previous)
      for (const line of finished) {
        const candidates = visibleLeads(leads, next).filter(lead => lead.status === 'open' && !next.has(lead.id))
        const id = matchLead(line.text, candidates)
        if (id) next.add(id)
      }
      return next.size === previous.size ? previous : next
    })
  }, [transcript, leads])
  return asked
}
