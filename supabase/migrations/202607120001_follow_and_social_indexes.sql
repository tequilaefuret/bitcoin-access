-- Harden social graph and message reaction tables.
-- This migration is safe to apply on top of the current schema.

-- Prevent duplicate follow relationships and self-following.
create unique index if not exists follows_follower_following_unique
  on public.follows (follower_address, following_address);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'follows_no_self_follow'
  ) then
    alter table public.follows
      add constraint follows_no_self_follow
      check (follower_address <> following_address);
  end if;
end $$;

create index if not exists follows_follower_address_idx
  on public.follows (follower_address);

create index if not exists follows_following_address_idx
  on public.follows (following_address);

-- One reaction per user/message pair.
create unique index if not exists message_likes_message_user_unique
  on public.message_likes (message_id, bitcoin_address);

create unique index if not exists message_dislikes_message_user_unique
  on public.message_dislikes (message_id, bitcoin_address);

create index if not exists message_likes_message_id_idx
  on public.message_likes (message_id);

create index if not exists message_dislikes_message_id_idx
  on public.message_dislikes (message_id);

-- Feed and profile performance.
create index if not exists messages_author_created_at_idx
  on public.messages (bitcoin_address, created_at desc);

create index if not exists messages_parent_id_idx
  on public.messages (parent_id);

create index if not exists messages_repost_of_idx
  on public.messages (repost_of);

create index if not exists messages_deleted_at_idx
  on public.messages (deleted_at);

create index if not exists transactions_address_created_at_idx
  on public.transactions (bitcoin_address, created_at desc);

create index if not exists canvas_pixels_address_updated_at_idx
  on public.canvas_pixels (bitcoin_address, updated_at desc);

create index if not exists user_balances_address_idx
  on public.user_balances (bitcoin_address);
