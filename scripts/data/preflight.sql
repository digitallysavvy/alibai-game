-- Read-only collision inspection: any returned row requires adaptation before installation.
select n.nspname as schema_name,c.relname as existing_object,c.relkind
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname=any(array['players','scenarios','scenario_secrets','suspects','evidence','secret_evidence','suggested_questions','scenario_facts','scenario_allocations','game_sessions','session_assignment_requests','player_scenario_history','session_events','session_facts','session_clues','session_updates','verdicts','scores','scenario_generation_jobs','agent_runs','avatar_catalog']);
select n.nspname as schema_name,p.proname as existing_function
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname=any(array['freeze_scenario_content','publish_scenario','assign_scenario','session_action','read_leaderboard','agent_lifecycle','assign_session_avatar','freeze_session_assignment','freeze_avatar_identity','end_session','release_unstarted_session','speech_normalize']);
