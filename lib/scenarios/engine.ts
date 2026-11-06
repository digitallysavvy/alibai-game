import { allEvidence, factDTO, publicEvidenceDTO, publicSuspectDTO, questionDTO, type Scenario } from './schema';
export function notebook(s:Scenario,factIds:string[]){const found=new Set(factIds);const shown=allEvidence(s).filter(e=>e.availability==='public'||e.trigger.allFactIds.every(id=>found.has(id)));
 // Sorted by ID so a red herring is not always the last public card.
 return [...shown.filter(e=>e.availability==='public').sort((a,b)=>a.id.localeCompare(b.id)),...shown.filter(e=>e.availability!=='public')].map(publicEvidenceDTO)}
export function suggestions(s:Scenario,factIds:string[],offset=0){
 if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid question offset');
 const known=new Set([...factIds,...notebook(s,factIds).map(e=>e.id)]);
 const eligible=s.suggestedQuestions.filter(q=>q.spoilerSafety!=='spoiler'&&q.prerequisiteIds.every(id=>known.has(id))).sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
 return {questions:eligible.slice(offset,offset+3).map(questionDTO),more:offset+3<eligible.length?offset+3:null};
}
/**
 * The notebook's leads: every non-spoiler question whose prerequisites the player has met, in
 * priority order, each marked answered once a fact it reveals is on record, with those facts
 * beneath it. Follow-ups surface on their own as facts and evidence unlock them. Facts recorded
 * without a listed lead on the page come back as admissions so nothing discovered is hidden.
 * Only recorded facts are ever serialized: an open lead carries no fact, ID or category.
 */
export function leads(s:Scenario,factIds:string[]){
 const facts=new Map(s.knowledge.facts.map(f=>[f.id,f] as const));
 const found=new Set(factIds.filter(id=>facts.has(id)));
 const known=new Set([...found,...notebook(s,[...found]).map(e=>e.id)]);
 const eligible=s.suggestedQuestions.filter(q=>q.spoilerSafety!=='spoiler'&&q.prerequisiteIds.every(id=>known.has(id))).sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
 const leads=eligible.map(q=>{const revealed=q.revealsFactIds.filter(id=>found.has(id)).map(id=>factDTO(facts.get(id)!));return {...questionDTO(q),status:revealed.length?'answered' as const:'open' as const,facts:revealed}});
 const listed=new Set(leads.flatMap(l=>l.facts.map(f=>f.id)));
 const admissions=s.knowledge.facts.filter(f=>found.has(f.id)&&!listed.has(f.id)).map(factDTO);
 return {leads,admissions};
}
export function briefing(s:Scenario,sessionId:string,casting?:{avatarId:string;voiceId:string}){return {sessionId,caseId:s.scenarioId,title:s.title,publicBriefing:s.publicBriefing,publicSuspect:{...publicSuspectDTO(s.suspect),...casting},publicEvidence:notebook(s,[]),initialSuggestedQuestions:suggestions(s,[]).questions}}
export function score(s:Scenario,verdict:'guilty'|'innocent',evidenceIds:string[],factIds:string[],elapsedSeconds:number){
 if (!Number.isFinite(elapsedSeconds)) throw new Error('Invalid elapsed time');
 const cited=new Set(evidenceIds),found=new Set(factIds.filter(id=>s.knowledge.facts.some(f=>f.id===id)));
 const visible=new Set(notebook(s,[...found]).map(e=>e.id));
 const verdictPoints=verdict===s.answerKey.verdict?500:0;
 // Mirrors session_action: a wrong verdict earns no evidence points, and a citation that isn't pivotal cancels one that is.
 const hits=s.answerKey.pivotal.filter(p=>cited.has(p.evidenceId)&&visible.has(p.evidenceId)).length;
 const evidencePoints=verdictPoints?Math.floor(300*Math.max(0,hits-(cited.size-hits))/s.answerKey.pivotal.length):0;
 const factPoints=Math.floor(150*found.size/s.knowledge.facts.length);
 const timePoints=found.size?Math.floor(50*Math.max(0,180-Math.max(0,elapsedSeconds))/180):0;
 return {verdictPoints,evidencePoints,factPoints,timePoints,total:verdictPoints+evidencePoints+factPoints+timePoints,scoringVersion:1,reasonCodes:[verdictPoints?'VERDICT_CORRECT':'VERDICT_INCORRECT',...(evidencePoints<300?['PIVOTAL_EVIDENCE_MISSING']:[])]};
}
