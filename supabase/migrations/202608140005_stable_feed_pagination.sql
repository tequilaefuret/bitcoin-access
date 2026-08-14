-- Indexes for stable keyset pagination of chronological social feeds.
-- The UUID tie-breaker prevents duplicates or skipped rows when several posts
-- share the same creation timestamp.

create index if not exists messages_chronological_feed_cursor_idx
  on public.messages (created_at desc, id desc)
  where deleted_at is null and parent_id is null;

create index if not exists messages_followed_feed_cursor_idx
  on public.messages (bitcoin_address, created_at desc, id desc)
  where deleted_at is null and parent_id is null;
