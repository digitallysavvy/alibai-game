'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { gameRequest, leaderboardPath } from '@/lib/game/api'
interface Entry {playerId:string;detectiveName:string;total:number;bestScore:number;gamesPlayed:number}
export function LiveLeaderboard({compact=false}:{compact?:boolean}) {
 const [rows,setRows]=useState<Entry[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true)
 async function refresh(fresh=false){try{setRows(await gameRequest<Entry[]>(leaderboardPath(fresh)));setError('')}catch(e){setError(e instanceof Error?e.message:'Could not load standings.')}finally{setLoading(false)}}
 // The results page links here with ?fresh, so a score just filed shows at once.
 useEffect(()=>{void refresh(new URLSearchParams(window.location.search).has('fresh'))},[])
 return <section className="mt-8"><div className="flex justify-between"><p className="label-mono text-ivory/55">Verified player scores</p><button type="button" className="min-h-11 text-sm text-gold underline" onClick={()=>void refresh(true)}>Refresh</button></div>{error&&<p role="alert" className="mt-3 text-sm text-ivory">{error}</p>}{loading&&<p className="text-ivory/50">Loading standings…</p>}
 <ol className="mt-4 divide-y divide-gold/15 border border-gold/20">{rows.slice(0,compact?8:50).map((row,index)=><li key={row.playerId} className="flex items-center gap-4 bg-charcoal/20 p-4"><span className="font-mono text-gold">{index+1}</span><div className="flex-1"><p className="font-display text-xl text-ivory">{row.detectiveName}</p><p className="text-xs text-ivory/50">{row.gamesPlayed} cases · best {row.bestScore}/1,000</p></div><span className="font-mono text-lg text-ivory">{row.total}</span></li>)}</ol>
 {!loading&&!rows.length&&!error&&<p className="mt-5 text-sm text-ivory/50">No completed cases yet. File the first verdict.</p>}<Link href="/rules" className="mt-6 block text-gold underline">Start investigation</Link></section>
}
