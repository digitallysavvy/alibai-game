# Writing a case

Each case is one file in `lib/scenarios/cases/`, listed in `lib/scenarios/fixtures.ts`. A case has to be fair once the facts are found and impossible to call before then.

After changing a case, run `pnpm scenarios:validate`, `pnpm test` and `pnpm data:build`. Published cases are immutable, so a changed case publishes as a new one and the old one is retired.

## How a case plays

- The player gets the public file, then has three minutes to question one suspect out loud.
- **The public file must be close to 50/50.** Before calling a case done, argue the opposite verdict from public material alone. If that argument isn't persuasive, the case isn't finished.
- **Exactly one pivotal item is public.** The others are discoverable, and they settle the case fairly.
- **Evidence is a record for the player to interpret.** The inference goes in `interpretation`, which players only see on the results screen.
- Each suggested question must lead to the fact it says it reveals, and that fact must really answer the question.

## Suspects

- **Guilty suspects lie.** Each has a narrow false claim about the crime in `knowledge.misleading`, and a discoverable record contradicts it. That contradiction is pivotal.
- **Guilty facts are pieces, never a confession.** Access, ownership, a detail only the culprit would know. No fact says "I did it" or gives the motive alongside the act.
- **Lying doesn't prove guilt.** Innocent suspects may hide something unrelated, and some hide nothing at all.
- **Innocent suspects only know what they'd really know.** They don't know who did it. The prompt withholds the real culprit from them.
- A fact can't be both admitted immediately and lied about. Secrets must be real secrets, and fact statements can't be near-duplicates.

## Spoken lines

A fact registers when the suspect's reply contains one of its `disclosurePhrases`. Matching ignores case, punctuation, apostrophes and contraction forms. Each fact needs:

- 3–5 lines of 4–12 words that a person would really say, with contractions
- Letters and basic punctuation only: no digits, colons, semicolons, quotes or curly apostrophes
- Positive statements. A line beside `not`, `never`, `no`, `if` or `unless` is rejected, so don't build those words in
- Lines unique to that fact, and absent from every alibi and lie

## What gives a case away

Blind readers called all eight verdicts correctly from public text when these were present:

| Tell | Instead |
| --- | --- |
| Profiles hint at the outcome: "painfully honest", "careful when the printer comes up" | Describe how they come across, with nothing a detective couldn't see. Mix warm and clipped across verdicts |
| Only guilty suspects have a motive | Every suspect has a visible stake |
| Only innocent suspects are vulnerable | Mix them. Some guilty suspects have the most to lose |
| Innocent cases show an exit route or a misheard sound | Put these in guilty cases too. Keep the real culprit's trail out of public view |
| Only guilty suspects have a signed record with a gap | Give innocent suspects these too, explained only by discoverable records |
| The third question probes motive for guilty suspects and the harmless secret for innocent ones | Every suspect gets a money or gain question and a personal one |
| Hedged wording: "is certain she heard", "says" | Report all witnesses in the same register |
| The briefing presupposes guilt: "which records show it" | Stay neutral, or drop the closing line |
| The red herring looks different from other cards | Give it a real title, and a source and kind that a real exhibit in that case uses. Vary its position |
| Tone splits: guilty suspects expansive, innocent ones frightened | Cross them. Some guilty suspects are anxious and some innocent ones are smug |
| Titles name the key mechanism or record | Use neutral titles that don't point either way |
| A public record kills the alternative only in guilty cases | Leave some alternatives standing in guilty cases, and appear to rule some out in innocent ones |
| Evidence stacks up so uniformly that it reads as a frame | Thin the stack, and let some guilty cases carry one too |
| The crime hurts the suspect only in innocent cases | Have some guilty suspects seem to lose by it, explained by discoverable records |
| Only innocent suspects point at the culprit, and only those cases have a third party with a motive on record | Give some guilty cases a real third-party record that the evidence rules out. Let some innocent suspects simply clear themselves |

`validateCaseSet` catches words and shapes that split on guilt. It can't catch tone, so test the set with two fresh readers, each given the cases in random order and no answers:

- **Blind read:** public files only. They should do little better than chance, with low confidence.
- **Fair-play read:** public files plus every fact and record. They should get nearly all of them, firmly.

Rerun both after any rewrite. A broad prose polish once took a blind reader from 9 of 16 to 13 of 16, so keep late edits narrow.

## Keep it human

- No shared chassis. Vary how briefings open and end. Not every briefing ends by saying the suspect is available to talk.
- Avoid three-beat lists, balanced clauses, neat closing lines, and "not X but Y".
- Some suspects have a verbal tic, and most don't. Avatar descriptions vary in length and shape.
- Questions sound like a person talking. "Your tour ran twenty minutes over. Why?" is the bar. Don't overuse "Statement. How does X?", and don't ask about what's already in the file.
- Records look like records. Logs can use `19:10`, and people speak in words.
- Don't reuse a device across many cases: rain-smudged names, torn paper corners, contract renewals, cabinets.
- Keep it cozy, fictional and non-graphic, with no real people or brands.
