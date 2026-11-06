-- Safe verification: no truth, transcripts, credentials or private dossiers are selected.
select c.relname as table_name,c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname=any(array['players','scenarios','scenario_secrets','suspects','evidence','secret_evidence','suggested_questions','scenario_facts','scenario_allocations','game_sessions','session_assignment_requests','player_scenario_history','session_events','session_facts','session_clues','session_updates','verdicts','scores','scenario_generation_jobs','agent_runs','avatar_catalog']) order by c.relname;
select schemaname,tablename,policyname,roles,cmd from pg_policies
where schemaname='public' and tablename=any(array['players','scenarios','scenario_secrets','suspects','evidence','secret_evidence','suggested_questions','scenario_facts','scenario_allocations','game_sessions','session_assignment_requests','player_scenario_history','session_events','session_facts','session_clues','session_updates','verdicts','scores','scenario_generation_jobs','agent_runs','avatar_catalog']) order by tablename,policyname;
select count(*) as published_fixture_count from public.scenarios where status='published' and generator_version like 'handcrafted-%';
select count(*) as enabled_avatar_count from public.avatar_catalog where enabled;
select p.proname,has_function_privilege('anon',p.oid,'EXECUTE') as anon_can_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') as browser_can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['freeze_scenario_content','publish_scenario','assign_scenario','session_action','read_leaderboard','agent_lifecycle','assign_session_avatar','freeze_session_assignment','freeze_avatar_identity','end_session','release_unstarted_session','speech_normalize','session_connect','session_ready']);
select role_name,table_name,has_table_privilege(role_name,'public.'||table_name,'SELECT') as can_select
from unnest(array['anon','authenticated']) role_name cross join unnest(array['scenario_secrets','secret_evidence','scenario_facts','suggested_questions','session_events','session_facts','verdicts','scores','agent_runs','scenario_generation_jobs','scenario_allocations','session_assignment_requests','avatar_catalog']) table_name;
