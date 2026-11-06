import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { DecoRule, Eyebrow, Monogram } from '@/components/game/deco'
import { PlayerSetup } from '@/components/game/player-setup'

const STEPS = [
  {
    numeral: 'I',
    title: 'Study the evidence',
    body: 'Open the case dossier. Read the crime summary, the public evidence, and the profile of your assigned suspect.',
  },
  {
    numeral: 'II',
    title: 'Interrogate the suspect',
    body: 'Speak naturally through your microphone. The suspect answers in real time. Suggested questions help you find leads, but nothing is sent until you ask it aloud.',
  },
  {
    numeral: 'III',
    title: 'Submit your verdict',
    body: 'When the clock runs out, or sooner if you are certain, decide guilty or innocent and cite the clues that convinced you.',
  },
]

export default function RulesPage() {
  return (
    <main className="relative min-h-dvh bg-obsidian spotlight">
      <div className="absolute inset-0 grain opacity-30 mix-blend-soft-light" aria-hidden />
      <div className="relative mx-auto flex max-w-2xl flex-col px-6 pb-16 pt-6">
        <header className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 label-mono text-ivory/60 hover:text-gold">
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
          <Monogram className="size-8" />
        </header>

        <section className="mt-12 text-center">
          <Eyebrow>Standing orders</Eyebrow>
          <h1 className="mt-3 font-display text-4xl font-medium text-ivory md:text-5xl">How to Play</h1>
          <DecoRule className="mx-auto mt-6 w-40" />
        </section>

        <ol className="mt-10 flex flex-col gap-6">
          {STEPS.map((step, i) => (
            <li
              key={step.numeral}
              className="flex gap-5 border-l border-gold/30 pl-5 animate-reveal"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <span className="font-display text-3xl font-light leading-none text-gold">{step.numeral}</span>
              <div>
                <h2 className="font-display text-xl font-medium text-ivory">{step.title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-ivory/65">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <section className="mt-10 grid grid-cols-2 gap-px border border-border bg-border">
          <div className="bg-obsidian p-4">
            <p className="label-mono text-ivory/50">Time limit</p>
            <p className="mt-2 font-mono text-2xl text-gold">03:00</p>
            <p className="mt-1 text-xs text-ivory/55">The clock starts only once the suspect is connected.</p>
          </div>
          <div className="bg-obsidian p-4">
            <p className="label-mono text-ivory/50">Scoring</p>
            <p className="mt-2 font-mono text-2xl text-gold">1,000</p>
            <p className="mt-1 text-xs text-ivory/55">500 verdict · 300 evidence · 150 verified facts · 50 time bonus. Evidence only counts with the right verdict, and a citation that doesn't hold up cancels one that does. Finish without a single fact and there's no time bonus.</p>
          </div>
        </section>

        <PlayerSetup />
      </div>
    </main>
  )
}
