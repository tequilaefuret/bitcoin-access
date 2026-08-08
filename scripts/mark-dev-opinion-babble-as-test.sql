-- One-time DEV cleanup. Do not run on production.
-- The database contains 52 historical test messages, not the estimated 50.

do $$
declare
  candidate_count integer;
begin
  select count(*)::integer
  into candidate_count
  from public.messages
  where content_origin = 'human';

  if candidate_count <> 52 then
    raise exception
      'Expected exactly 52 DEV babble messages, found %; no rows changed',
      candidate_count;
  end if;

  update public.messages
  set content_origin = 'test'
  where content_origin = 'human';
end;
$$;

select content_origin, count(*)::integer as message_count
from public.messages
group by content_origin
order by content_origin;
