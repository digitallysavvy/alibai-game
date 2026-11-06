/**
 * Decides whether a finished player caption asked one of the leads on the notebook page.
 * Pure and browser-only: no model, no network, no game state. Its only effect is the
 * "asked" mark on a lead, which never touches facts or the score. Speech-to-text drops
 * fillers, mishears word endings and writes numbers as digits, so the comparison works on
 * stemmed content words with a one-letter tolerance rather than on exact text.
 */

const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'hmm', 'mm', 'ah', 'oh', 'okay', 'ok', 'well', 'like', 'right', 'yeah', 'yes', 'no', 'hey',
  'please', 'just', 'actually', 'basically', 'look', 'listen', 'now', 'mister', 'mr', 'mrs', 'ms', 'miss', 'sir', 'madam', 'maam', 'detective'])
const STOPWORDS = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'is', 'was', 'were', 'are', 'be', 'been', 'being', 'am', 'you', 'your', 'yours', 'yourself',
  'did', 'do', 'does', 'done', 'that', 'this', 'these', 'those', 'it', 'its', 'and', 'or', 'but', 'for', 'with', 'there', 'their', 'they', 'them', 'then', 'than',
  'about', 'me', 'my', 'i', 'we', 'our', 'us', 'he', 'she', 'his', 'her', 'him', 'have', 'has', 'had', 'can', 'could', 'would', 'should', 'will', 'shall', 'may',
  'might', 'get', 'got', 'tell', 'say', 'up', 'out', 'off', 'by', 'as', 'from', 'into', 'any', 'some', 'all', 'not', 'if', 'so', 'very', 'really', 'ever', 'again',
  'let', 'lets', 'want', 'know', 'think', 'mean', 'ask', 'asking', 'question', 'one', 'thing', 'things'])
const NUMBERS: Record<string, string> = { '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
  '10': 'ten', '11': 'eleven', '12': 'twelve', '13': 'thirteen', '14': 'fourteen', '15': 'fifteen', '16': 'sixteen', '17': 'seventeen', '18': 'eighteen', '19': 'nineteen',
  '20': 'twenty', '30': 'thirty', '40': 'forty', '50': 'fifty', '60': 'sixty', '70': 'seventy', '80': 'eighty', '90': 'ninety', '100': 'hundred', '1000': 'thousand' }

/** Lowercase, contractions opened, digits spelled out, everything but letters, digits and spaces removed. */
export function normalizeSpeech(text: string): string {
  return text.toLowerCase().replace(/[’‘ʼ`´]/g, "'")
    .replace(/\bcan't\b/g, 'can not').replace(/\bcannot\b/g, 'can not').replace(/\bwon't\b/g, 'will not')
    .replace(/n't\b/g, ' not').replace(/'re\b/g, ' are').replace(/'ve\b/g, ' have').replace(/'ll\b/g, ' will')
    .replace(/'d\b/g, ' would').replace(/\bi'm\b/g, 'i am').replace(/\b(it|that|there|here|he|she|what|who|where|when|how)'s\b/g, '$1 is')
    .replace(/'/g, '').replace(/(\d)[:.](\d)/g, '$1 $2').replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/\b\d+\b/g, digits => NUMBERS[digits] ?? digits)
}

// Nouns that end in -ing and would be mangled by the stem below.
const KEEP_ING = new Set(['morning', 'evening', 'nothing', 'something', 'anything', 'everything', 'during', 'ceiling', 'building', 'wedding', 'meeting', 'landing', 'railing', 'siding', 'string', 'spring'])

/** A light stem so "keys", "asked" and "asking" line up with "key", "ask" and "ask". */
export function stem(word: string): string {
  if (word.length >= 5 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length >= 6 && word.endsWith('ing') && !KEEP_ING.has(word)) return word.slice(0, -3)
  if (word.length >= 5 && word.endsWith('ed')) return word.slice(0, -2)
  if (word.length >= 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

/** The words that carry a question's meaning, stemmed, in order of appearance, without repeats. */
export function contentTokens(text: string): string[] {
  const seen = new Set<string>()
  for (const raw of normalizeSpeech(text).split(' ')) {
    if (!raw || FILLERS.has(raw) || STOPWORDS.has(raw)) continue
    seen.add(stem(raw))
  }
  return [...seen]
}

function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      rowMin = Math.min(rowMin, current[j])
    }
    if (rowMin > limit) return limit + 1
    previous = current
  }
  return previous[b.length]
}

/** Equal after stemming, or one letter apart when both are long enough for that to be a mishearing. */
export function similarWord(a: string, b: string): boolean {
  if (a === b) return true
  const shortest = Math.min(a.length, b.length)
  if (shortest < 5) return false
  return editDistance(a, b, shortest >= 8 ? 2 : 1) <= (shortest >= 8 ? 2 : 1)
}

/** Share of a lead's content words that the spoken turn covers, 0 to 1. */
export function leadCoverage(spoken: string, leadText: string): number {
  const said = contentTokens(spoken), wanted = contentTokens(leadText)
  if (!wanted.length || !said.length) return 0
  const hits = wanted.filter(word => said.some(candidate => similarWord(word, candidate))).length
  if (hits < Math.min(2, wanted.length)) return 0
  return hits / wanted.length
}

/** Open leads kept on the page at once. Asked and answered leads stay regardless, so the page never empties. */
export const OPEN_LEAD_SLOTS = 3

/**
 * Which of the server's leads the notebook page shows, in the server's order: every answered lead,
 * every lead the player has asked, and the first few open ones not yet asked. Asking a lead that
 * earns no answer therefore brings the next one up, so a player with time left always has a lead.
 */
export function visibleLeads<T extends { id: string; status: 'open' | 'answered' }>(leads: readonly T[], asked: ReadonlySet<string>, slots = OPEN_LEAD_SLOTS): T[] {
  let open = 0
  return leads.filter(lead => lead.status === 'answered' || asked.has(lead.id) || open++ < slots)
}

export const LEAD_MATCH_THRESHOLD = 0.6

/**
 * The lead the turn asked, or null. The best coverage at or above the threshold wins; a dead
 * heat between two leads is left alone rather than guessed, and an empty page matches nothing.
 */
export function matchLead(spoken: string, leads: readonly { id: string; text: string }[]): string | null {
  let best: { id: string; score: number } | null = null, tied = false
  for (const lead of leads) {
    const score = leadCoverage(spoken, lead.text)
    if (score < LEAD_MATCH_THRESHOLD) continue
    if (!best || score > best.score) { best = { id: lead.id, score }; tied = false }
    else if (score === best.score) tied = true
  }
  return best && !tied ? best.id : null
}
