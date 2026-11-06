import { allEvidence, scenarioSchema, type Scenario } from './schema';
import { fingerprint, similarity } from './fingerprint';
import { speechNormalize } from './provider-disclosures';
export function validateScenario(input:unknown, existing:Scenario[] = []) {
  const parsed=scenarioSchema.safeParse(input);
  if(!parsed.success) return {valid:false as const, errors:parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`)};
  const s=parsed.data, errors:string[]=[];
  const check=(ok:boolean,message:string)=>{if(!ok) errors.push(message)};
  const evidence=allEvidence(s), facts=s.knowledge.facts, questions=s.suggestedQuestions;
  const allIds=[s.suspect.id,...evidence.map(e=>e.id),...facts.map(f=>f.id),...questions.map(q=>q.id),...s.truth.timeline.map(t=>t.id)];
  check(new Set(allIds).size===allIds.length,'duplicate IDs');
  const fs=new Set(facts.map(f=>f.id)), es=new Set(evidence.map(e=>e.id));
  check(evidence.every(e=>!/(red[_-]?herring|^red-\d|pivotal|guilty|innocent|culprit)/i.test(e.id)), 'evidence ID leaks private classification');
  const known=new Set([...fs,...es]);
  const refs=(ids:string[],allowed:Set<string>,where:string)=>ids.forEach(id=>check(allowed.has(id),`${where}: missing reference ${id}`));
  refs([...s.knowledge.knows,...s.knowledge.admitsImmediately,...s.knowledge.revealsWhenQuestioned],fs,'knowledge');
  check(facts.every(f=>s.knowledge.knows.includes(f.id)),'all disclosed facts must be known');
  for(const lie of s.knowledge.misleading) check(facts.find(f=>f.id===lie.factId)?.statement===lie.realFact,'misleading statement must cite real fact verbatim');
  for(const f of facts) refs(f.prerequisiteFactIds,fs,f.id);
  // Disclosure only works if the suspect can say these lines and a lie can never say one by accident.
  const lieIds=new Set(s.knowledge.misleading.map(lie=>lie.factId));
  check(s.knowledge.admitsImmediately.every(id=>!lieIds.has(id)),'a fact cannot be admitted immediately and also hidden by a lie');
  check(!s.truth.guilty||s.knowledge.misleading.length>0,'a guilty suspect needs a lie that a record can catch');
  for(const f of facts){
   check(f.disclosurePhrases.length>=3,`${f.id}: needs at least three spoken lines`);
   for(const phrase of f.disclosurePhrases){
    const count=phrase.trim().split(/\s+/).length;
    check(count>=4&&count<=12,`${f.id}: spoken line must be 4–12 words: ${phrase}`);
    check(/^[A-Za-z' ,.!-]+$/.test(phrase),`${f.id}: spoken line has unspeakable characters: ${phrase}`);
   }
  }
  const lines=facts.flatMap(f=>f.disclosurePhrases.map(phrase=>({id:f.id,spoken:` ${speechNormalize(phrase)} `})));
  for(const a of lines)for(const b of lines)check(a.id===b.id||!a.spoken.includes(b.spoken),`${a.id}: spoken line overlaps ${b.id}`);
  const lieText=` ${speechNormalize([s.truth.realAlibi,...s.knowledge.misleading.map(lie=>lie.permittedDeception)].join(' '))} `;
  check(lines.every(l=>!lieText.includes(l.spoken)),'an alibi or lie would disclose a fact');
  const factWords=facts.map(f=>new Set(speechNormalize(f.statement).split(' ')));
  factWords.forEach((a,i)=>factWords.slice(i+1).forEach(b=>check([...a].filter(w=>b.has(w)).length/new Set([...a,...b]).size<0.7,'near-duplicate fact statements')));
  for(const e of evidence) {refs(e.trigger.allFactIds,fs,e.id);check(e.availability==='public'?e.trigger.allFactIds.length===0:e.trigger.allFactIds.length>0,'evidence visibility/trigger mismatch');}
  check(s.publicEvidence.every(e=>e.availability==='public')&&s.discoverableEvidence.every(e=>e.availability==='discoverable'),'evidence in wrong visibility collection');
  for(const q of questions){refs(q.prerequisiteIds,known,q.id);refs(q.revealsFactIds,fs,q.id);}
  const pivotal=s.answerKey.pivotal.map(p=>p.evidenceId), red=s.answerKey.misleading.map(p=>p.evidenceId);
  refs([...pivotal,...red],es,'answer key');
  check(new Set([...pivotal,...red]).size===pivotal.length+red.length,'duplicate or conflicting scoring references');
  check(red.every(id=>s.redHerrings.some(e=>e.id===id)),'misleading references must be red herrings');
  check(s.answerKey.verdict===(s.truth.guilty?'guilty':'innocent'),'contradictory verdict');
  check(s.truth.guilty===(s.truth.culpritId===s.suspect.id),'contradictory culprit');
  const words=s.publicBriefing.trim().split(/\s+/).length;check(words>=100&&words<=180,'briefing must contain 100–180 words');
  const publicText=[s.publicBriefing,s.title,s.setting,s.crime,...Object.values(s.suspect),...evidence.filter(e=>e.availability==='public').flatMap(e=>[e.title,e.description,e.source]),...questions.filter(q=>!q.prerequisiteIds.length).map(q=>q.text)].join(' ').toLowerCase();
  for(const secret of [s.truth.actualEvent,s.truth.explanation,...s.discoverableEvidence.map(e=>e.description)]) check(!publicText.includes(secret.toLowerCase()),'private answer leaked into public content');
  check(!/\b(suspect is (guilty|innocent)|correct verdict|actual culprit)\b/i.test(publicText),'explicit verdict leaked into public content');
  for (const grant of s.truth.access) check(Date.parse(grant.from)<=Date.parse(grant.until),'negative access interval');
  const timeline=s.truth.timeline;
  timeline.forEach((t,i)=>{
    check(Date.parse(t.at)<=Date.parse(t.until),'negative timeline interval');
    if(i)check(Date.parse(t.at)>=Date.parse(timeline[i-1].at),'non-monotonic timeline');
    if(t.requiresAccess)check(s.truth.access.some(a=>a.actorId===t.actorId&&a.location===t.location&&a.from<=t.at&&a.until>=t.until),'impossible access');
    for(const u of timeline.slice(i+1))check(!(u.actorId===t.actorId&&u.location!==t.location&&Date.parse(t.at)<Date.parse(u.until)&&Date.parse(u.at)<Date.parse(t.until)),'impossible location overlap');
  });
  // Facts and evidence have AND dependencies; questions are consumers, never prerequisites.
  const graph=new Map<string,string[]>([...facts.map(f=>[f.id,f.prerequisiteFactIds] as [string,string[]]),...evidence.map(e=>[e.id,e.trigger.allFactIds] as [string,string[]])]);
  const visiting=new Set<string>(),done=new Set<string>();
  const visit=(id:string):void=>{if(visiting.has(id)){errors.push('circular prerequisite graph');return;}if(done.has(id))return;visiting.add(id);for(const dep of graph.get(id)??[])visit(dep);visiting.delete(id);done.add(id)};
  for(const id of graph.keys())visit(id);
  const initial=evidence.filter(e=>e.availability==='public').map(e=>e.id);
  check(questions.filter(q=>q.spoilerSafety==='safe'&&q.prerequisiteIds.every(id=>initial.includes(id))).length>=3,'fewer than three starting questions');
  const reachable=new Set(initial);
  for(let i=0;i<allIds.length;i++){
    for(const q of questions.filter(q=>q.spoilerSafety!=='spoiler'))if(q.prerequisiteIds.every(id=>reachable.has(id)))for(const id of q.revealsFactIds){if(facts.find(f=>f.id===id)?.prerequisiteFactIds.every(d=>reachable.has(d)))reachable.add(id)}
    for(const e of evidence)if(e.trigger.allFactIds.every(id=>reachable.has(id)))reachable.add(e.id);
  }
  check([...fs,...es].every(id=>reachable.has(id)),'unsatisfiable clue/question unlock graph');
  const pathKnown=new Set(initial);
  for(const step of s.solvabilityPath){
    const q=questions.find(q=>q.id===step.questionId);
    check(!!q&&q.spoilerSafety!=='spoiler'&&q.prerequisiteIds.every(id=>pathKnown.has(id)),'invalid or spoiler solvability path');
    refs(step.expectedFactIds,fs,'solvability');
    check(step.expectedFactIds.length>0&&step.expectedFactIds.every(id=>q?.revealsFactIds.includes(id)&&facts.find(f=>f.id===id)?.prerequisiteFactIds.every(d=>pathKnown.has(d))),'path revelation not supported');
    step.expectedFactIds.forEach(id=>pathKnown.add(id));
    for(const e of evidence)if(e.trigger.allFactIds.every(id=>pathKnown.has(id)))pathKnown.add(e.id);
  }
  check(pivotal.every(id=>pathKnown.has(id)),'path cannot reach pivotal evidence');
  check(s.fingerprint===fingerprint(s),'fingerprint mismatch');
  check(!existing.some(e=>e.fingerprint===s.fingerprint),'duplicate fingerprint');
  const needsHumanReview=existing.some(e=>similarity(s,e)>0.8);
  return {valid:errors.length===0,errors,scenario:s,needsHumanReview};
}
export function assertValid(input:unknown):Scenario {
  const result=validateScenario(input);if(!result.valid||!('scenario' in result))throw new Error(result.errors.join('; '));return result.scenario;
}
const publicWords=(s:Scenario)=>new Set(speechNormalize([s.publicBriefing,s.title,s.setting,s.crime,s.suspect.role,s.suspect.attitude,s.suspect.relationship,s.suspect.speechStyle,
 ...s.publicEvidence.flatMap(e=>[e.title,e.description,e.source]),...s.redHerrings.flatMap(e=>[e.title,e.description,e.source]),...s.suggestedQuestions.filter(q=>!q.prerequisiteIds.length).map(q=>q.text)].join(' ')).split(' ').filter(w=>w.length>=4));
const shape=(items:Scenario['publicEvidence'])=>items.map(e=>`${e.category==='red_herring'?'testimony':e.category}/${e.kind}`).sort().join(',');
/** Public signals that would let a returning player call a verdict without playing. */
const caseShape=(s:Scenario):Record<string,string|number>=>{
 const first=s.suspect.name.split(' ')[0].toLowerCase(), shown=[...s.publicEvidence,...s.redHerrings];
 return {publicCount:shown.length,discoverableCount:s.discoverableEvidence.length,factCount:s.knowledge.facts.length,questionCount:s.suggestedQuestions.length,
  publicShape:shape(shown),discoverableShape:shape(s.discoverableEvidence),publicSources:new Set(shown.map(e=>e.source)).size,
  herringNamesSuspect:String(s.redHerrings.some(e=>e.description.toLowerCase().includes(first))),
  exhibitsNameSuspect:s.publicEvidence.filter(e=>e.description.toLowerCase().includes(first)).length,
  herringIsLastCard:String(shown.map(e=>e.id).sort().at(-1)===s.redHerrings[0].id),
  alibiQuestion:String(s.suggestedQuestions.some(q=>q.category==='alibi'&&!q.prerequisiteIds.length))};
};
/** Checks across a published set, where a guilt tell shows up and a single case can't reveal one. */
export function validateCaseSet(cases:Scenario[]) {
 const errors:string[]=[], guilty=cases.filter(s=>s.truth.guilty), innocent=cases.filter(s=>!s.truth.guilty);
 if(!guilty.length||!innocent.length)return errors;
 if(!innocent.some(s=>s.knowledge.misleading.length===0))errors.push('at least one innocent suspect must tell no lie, or lying alone proves guilt');
 const shapes=cases.map(s=>({guilty:s.truth.guilty,shape:caseShape(s)}));
 for(const key of Object.keys(shapes[0].shape)){
  const values=(side:boolean)=>new Set(shapes.filter(c=>c.guilty===side).map(c=>c.shape[key]));
  const other=values(false);
  if(![...values(true)].some(v=>other.has(v)))errors.push(`public shape splits on guilt: ${key}`);
 }
 // A value that appears on only one side is a tell even when the other side is mixed.
 for(const key of ['publicCount','discoverableCount','factCount','questionCount','alibiQuestion'])for(const value of new Set(shapes.map(c=>c.shape[key]))){
  const on=(side:boolean)=>shapes.filter(c=>c.guilty===side&&c.shape[key]===value).length;
  if((on(true)>=2&&!on(false))||(on(false)>=2&&!on(true)))errors.push(`only one verdict has ${key}=${value}`);
 }
 const count=(side:Scenario[],word:string)=>side.filter(s=>publicWords(s).has(word)).length;
 const gate=(side:Scenario[])=>Math.ceil(side.length*0.6);
 for(const word of new Set(cases.flatMap(s=>[...publicWords(s)]))){
  const g=count(guilty,word), i=count(innocent,word);
  if((g>=gate(guilty)&&i===0)||(i>=gate(innocent)&&g===0))errors.push(`public word splits on guilt: ${word} (${g} guilty, ${i} innocent)`);
 }
 // A card that's usually the herring teaches players to skip it, whichever way the case falls.
 const herrings=cases.flatMap(s=>s.redHerrings.map(e=>e.id)), most=Math.max(...herrings.map(id=>herrings.filter(h=>h===id).length));
 if(most>Math.max(2,Math.ceil(cases.length*0.3)))errors.push('red herrings cluster on one card ID');
 return errors;
}
