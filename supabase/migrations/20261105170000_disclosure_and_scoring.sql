-- Scoring: see the verdict branch of session_action below.
-- Spoken replies rarely equal a scripted line exactly: they differ in punctuation, apostrophes
-- and contractions, and may carry a short lead-in. A fact now counts when its spoken line appears
-- in the reply. Every reply the old exact check accepted is still accepted, so this is safe to
-- apply before the server code that relies on it. Keep in step with speechNormalize in
-- lib/scenarios/provider-disclosures.ts.
create function public.speech_normalize(p_text text) returns text language sql immutable set search_path='' as $$
 select trim(regexp_replace(replace(
  regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
   translate(lower(p_text),'’‘ʼ`´',repeat('''',5)),
   '\mcan''t\M','can not','g'),'\mcannot\M','can not','g'),'\mwon''t\M','will not','g'),
   'n''t\M',' not','g'),'''re\M',' are','g'),'''ve\M',' have','g'),'''ll\M',' will','g'),
   '''d\M',' would','g'),'\mi''m\M','i am','g'),'\m(it|that|there|here|he|she|what|who)''s\M','\1 is','g'),
  '''',''),'[^a-z0-9]+',' ','g'))
$$;
revoke all on function public.speech_normalize(text) from public,anon,authenticated;
grant execute on function public.speech_normalize(text) to service_role;

create or replace function public.session_action(p_player uuid,p_session uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql set search_path='' as $$
declare g public.game_sessions; d jsonb; f jsonb; e jsonb; ev public.session_events; v public.verdicts;
 ids text[]; known text[]; n int; vp int; ep int; fp int; tp int; at_time timestamptz;
begin
 select * into g from public.game_sessions where id=p_session and player_id=p_player for update;
 if not found then raise exception 'SESSION_NOT_FOUND'; end if;
 -- Measure after acquiring the row lock: queued calls cannot reuse a pre-lock clock.
 at_time:=clock_timestamp();
 select dossier into d from public.scenario_secrets where scenario_id=g.scenario_id;
 if p_action='read' then return jsonb_build_object('session',to_jsonb(g),'scenario',d,'factIds',coalesce((select jsonb_agg(fact_id) from public.session_facts where session_id=g.id),'[]'),'score',(select to_jsonb(s) from public.scores s where s.session_id=g.id),'verdict',(select to_jsonb(verdict_row) from public.verdicts verdict_row where verdict_row.session_id=g.id));
 elsif p_action='start' then
  if g.state='created' then update public.game_sessions set state='active',started_at=at_time,updated_at=at_time where id=g.id; end if;
 elsif p_action='end' then
  if g.state='active' then update public.game_sessions set state='ended',ended_at=least(at_time,g.started_at+interval '180 seconds'),updated_at=at_time where id=g.id;
  elsif g.state not in ('ended','scored') then raise exception 'NOT_ACTIVE'; end if;
 elsif p_action='turn' then
  if g.state<>'active' or at_time>=g.started_at+interval '195 seconds' then raise exception 'NOT_ACTIVE'; end if;
  select * into ev from public.session_events where session_id=g.id and turn_id=p_payload->>'turnId';
  if found then
   if ev.transcript<>p_payload->>'transcript' or ev.actor<>p_payload->>'actor' or ev.source<>p_payload->>'source' then raise exception 'TURN_CONFLICT'; end if;
  else insert into public.session_events(session_id,turn_id,actor,transcript,source) values(g.id,p_payload->>'turnId',p_payload->>'actor',p_payload->>'transcript',p_payload->>'source'); end if;
 elsif p_action='fact' then
  if exists(select 1 from public.session_facts where session_id=g.id and fact_id=p_payload->>'factId') then return '{}'; end if;
  if g.state<>'active' or at_time>=g.started_at+interval '195 seconds' then raise exception 'NOT_ACTIVE'; end if;
  select private_data into f from public.scenario_facts where scenario_id=g.scenario_id and id=p_payload->>'factId';
  if not found then raise exception 'UNKNOWN_FACT'; end if;
  select * into ev from public.session_events where session_id=g.id and turn_id=p_payload->>'turnId' and actor='suspect' and source=p_payload->>'source';
  if not found or ev.created_at<g.started_at or ev.created_at>=g.started_at+interval '195 seconds' then raise exception 'UNVERIFIED_DISCLOSURE'; end if;
  -- The server rejects denials and quotes before calling this; here the spoken line must be present.
  if not exists(select 1 from jsonb_array_elements_text(f->'disclosurePhrases') p where public.speech_normalize(p)<>'' and position(' '||public.speech_normalize(p)||' ' in ' '||public.speech_normalize(ev.transcript)||' ')>0) then raise exception 'UNSUPPORTED_DISCLOSURE'; end if;
  if exists(select 1 from jsonb_array_elements_text(f->'prerequisiteFactIds') p where not exists(select 1 from public.session_facts sf where sf.session_id=g.id and sf.fact_id=p)) then raise exception 'FACT_LOCKED'; end if;
  insert into public.session_facts(session_id,scenario_id,fact_id,turn_id) values(g.id,g.scenario_id,p_payload->>'factId',ev.turn_id) on conflict do nothing;
  for e in select private_data from public.secret_evidence where scenario_id=g.scenario_id loop
   if not exists(select 1 from jsonb_array_elements_text(e->'trigger'->'allFactIds') p where not exists(select 1 from public.session_facts sf where sf.session_id=g.id and sf.fact_id=p)) then
    insert into public.session_clues(session_id,scenario_id,evidence_id,public_data) values(g.id,g.scenario_id,e->>'id',(e-'interpretation'-'trigger')||case when e->>'category'='red_herring' then '{"category":"testimony"}'::jsonb else '{}'::jsonb end) on conflict do nothing;
   end if;
  end loop;
  insert into public.session_updates(session_id,kind) values(g.id,'clues_and_suggestions');
 elsif p_action='verdict' then
  select array_agg(distinct value order by value) into ids from jsonb_array_elements_text(p_payload->'evidenceIds'); ids:=coalesce(ids,'{}');
  select * into v from public.verdicts where session_id=g.id;
  if found then
   if v.verdict<>p_payload->>'verdict' or v.evidence_ids<>ids or coalesce(v.reasoning,'')<>coalesce(p_payload->>'reasoning','') then raise exception 'VERDICT_LOCKED'; end if;
   return '{}';
  end if;
  if g.state='active' and at_time>=g.started_at+interval '180 seconds' then
   update public.game_sessions set state='ended',ended_at=started_at+interval '180 seconds',updated_at=at_time where id=g.id returning * into g;
  end if;
  if g.state<>'ended' then raise exception 'END_INTERROGATION_FIRST'; end if;
  if exists(select 1 from unnest(ids) as cited(evidence_id) where not exists(select 1 from public.evidence e where e.scenario_id=g.scenario_id and e.id=cited.evidence_id) and not exists(select 1 from public.session_clues c where c.session_id=g.id and c.evidence_id=cited.evidence_id)) then raise exception 'EVIDENCE_NOT_VISIBLE'; end if;
  vp:=case when p_payload->>'verdict'=d->'answerKey'->>'verdict' then 500 else 0 end;
  select count(*) into n from jsonb_array_elements(d->'answerKey'->'pivotal') p where p->>'evidenceId'=any(ids);
  -- A wrong verdict earns no evidence points, and each citation that isn't pivotal cancels one that is.
  ep:=case when vp=500 then floor(300.0*greatest(0,n-(cardinality(ids)-n))/jsonb_array_length(d->'answerKey'->'pivotal')) else 0 end;
  select count(*) into n from public.session_facts where session_id=g.id;
  fp:=floor(150.0*n/jsonb_array_length(d->'knowledge'->'facts'));
  -- A fast exit earns nothing until the interview has produced a fact.
  tp:=case when n>0 then floor(50.0*greatest(0,180-extract(epoch from (g.ended_at-g.started_at)))/180) else 0 end;
  insert into public.verdicts(session_id,verdict,evidence_ids,reasoning) values(g.id,p_payload->>'verdict',ids,p_payload->>'reasoning');
  insert into public.scores(session_id,verdict_points,evidence_points,fact_points,time_points,reason_codes) values(g.id,vp,ep,fp,tp,array[case when vp=500 then 'VERDICT_CORRECT' else 'VERDICT_INCORRECT' end]||case when ep<300 then array['PIVOTAL_EVIDENCE_MISSING'] else '{}'::text[] end);
  update public.game_sessions set state='scored',updated_at=at_time where id=g.id;
 else raise exception 'UNKNOWN_ACTION'; end if;
 if p_action in ('start','end','verdict') then insert into public.session_updates(session_id,kind) values(g.id,'state'); end if;
 return '{}';
end $$;
revoke all on function public.session_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.session_action(uuid,uuid,text,jsonb) to service_role;
