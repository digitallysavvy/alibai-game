import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DecoRule, Eyebrow, Monogram } from '@/components/game/deco'
import interrogationRoom from '@/public/images/interrogation-room.webp'

export default function LandingPage() {
  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-obsidian">
      <Image
        src={interrogationRoom}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-center opacity-70 animate-flicker"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-obsidian via-obsidian/60 to-obsidian" aria-hidden />
      <div className="absolute inset-0 grain opacity-40 mix-blend-soft-light" aria-hidden />

      <header className="relative z-10 flex items-center justify-between px-6 pt-6 md:px-10">
        <Monogram className="size-8" />
        <nav className="flex items-center gap-5 text-xs text-ivory/70">
          <Link href="/rules" className="label-mono hover:text-gold">
            How to play
          </Link>
          <Link href="/leaderboard" className="label-mono hover:text-gold">
            Leaderboard
          </Link>
        </nav>
      </header>

      <section className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <Eyebrow className="animate-reveal">Case file MM-2847 &middot; Open investigation</Eyebrow>

        <h1 className="mt-6 font-display text-[clamp(2.75rem,10vw,7rem)] font-medium uppercase leading-[0.9] tracking-[0.06em] text-ivory text-balance animate-reveal [animation-delay:80ms]">
          Interrogate
          <span className="block text-[0.42em] font-light italic normal-case tracking-[0.1em] text-gold">the</span>
          Agent
        </h1>

        <DecoRule className="mt-8 w-56 animate-reveal [animation-delay:160ms]" />

        <p className="mt-6 max-w-md font-display text-xl italic leading-snug text-ivory/85 text-balance animate-reveal [animation-delay:220ms] md:text-2xl">
          Everyone has a story. Not everyone is telling the truth.
        </p>

        <p className="mt-5 max-w-lg text-sm leading-relaxed text-ivory/60 text-balance animate-reveal [animation-delay:280ms] md:text-base">
          Step into the interrogation room. Question AI-powered suspects, uncover hidden clues, and decide who&apos;s
          telling the truth. You&apos;ve got three minutes to crack the case.
        </p>

        <div className="mt-10 flex w-full max-w-xs flex-col items-stretch gap-3 animate-reveal [animation-delay:340ms]">
          <Button
            size="lg"
            className="h-13 rounded-none bg-gold font-mono text-xs uppercase tracking-[0.22em] text-obsidian hover:bg-ivory"
            nativeButton={false} render={<Link href="/rules" />}
          >
            Start Investigation
            <ArrowRight data-icon="inline-end" />
          </Button>
          <Button
            variant="ghost"
            className="h-10 rounded-none font-mono text-[0.65rem] uppercase tracking-[0.22em] text-ivory/60 hover:bg-transparent hover:text-gold"
            nativeButton={false} render={<Link href="/leaderboard" />}
          >
            View the board
          </Button>
        </div>
      </section>

      <footer className="relative z-10 flex flex-col items-center gap-2 px-6 pb-8 text-center md:flex-row md:justify-between md:px-10">
        <p className="label-mono text-ivory/35">Real-time voice &middot; Three minutes &middot; One verdict</p>
        <p className="label-mono text-ivory/35">Powered by Supabase &middot; Agora &middot; Anam &middot; Secured by Sodabase</p>
      </footer>
    </main>
  )
}
