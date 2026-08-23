-- Keep both reply reading modes index-backed as conversations grow.
create index if not exists messages_replies_recent_idx
  on public.messages (parent_id, created_at desc, id desc)
  where deleted_at is null and parent_id is not null;

create index if not exists messages_replies_useful_idx
  on public.messages (parent_id, useful_count desc, created_at desc, id desc)
  where deleted_at is null and parent_id is not null;
