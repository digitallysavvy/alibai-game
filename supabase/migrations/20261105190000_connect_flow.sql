-- One call per interview step. Both functions wrap agent_lifecycle and session_action, so
-- claims, the clock and the read shape stay defined in one place. Additive: nothing existing
-- changes, and code still using agent_lifecycle directly behaves as before.

-- Owner check, session read and agent claim. A session that can no longer connect is read but
-- not claimed, so the page can still show it. claim.claimed tells exactly one caller to start.
create function public.session_connect(p_player uuid,p_session uuid) returns jsonb
language plpgsql set search_path='' as $$
declare g public.game_sessions; claim jsonb; begin
 select * into g from public.game_sessions where id=p_session and player_id=p_player for update;
 if not found then raise exception 'SESSION_NOT_FOUND'; end if;
 if g.state in ('created','preparing') or (g.state='active' and clock_timestamp()<g.started_at+interval '180 seconds') then
  claim:=public.agent_lifecycle(p_player,p_session,'claim');
 end if;
 return jsonb_build_object('claim',claim,'snapshot',public.session_action(p_player,p_session,'read'));
end $$;
revoke all on function public.session_connect(uuid,uuid) from public,anon,authenticated;
grant execute on function public.session_connect(uuid,uuid) to service_role;

-- Starts the clock for the run the caller checked, then returns the view. A run that isn't
-- the one checked never starts the clock. Calling it again never moves started_at.
create function public.session_ready(p_player uuid,p_session uuid,p_agent text) returns jsonb
language plpgsql set search_path='' as $$
declare g public.game_sessions; a public.agent_runs; begin
 select * into g from public.game_sessions where id=p_session and player_id=p_player for update;
 if not found then raise exception 'SESSION_NOT_FOUND'; end if;
 select * into a from public.agent_runs where session_id=g.id;
 if a.agent_id is null or a.agent_id is distinct from p_agent then raise exception 'AGENT_NOT_READY'; end if;
 perform public.agent_lifecycle(p_player,p_session,'ready');
 return public.session_action(p_player,p_session,'read');
end $$;
revoke all on function public.session_ready(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.session_ready(uuid,uuid,text) to service_role;
