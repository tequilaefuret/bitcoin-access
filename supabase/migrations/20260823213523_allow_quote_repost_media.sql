-- Allow quoted reposts to carry their own optimized photos. The original
-- publication media is deliberately excluded from the new author's charge.
drop function if exists public.toggle_or_create_message_repost(text, uuid, text);

create function public.toggle_or_create_message_repost(
  p_bitcoin_address text,
  p_target_message_id uuid,
  p_quote_content text default null,
  p_media jsonb default '[]'::jsonb
)
returns table(
  active boolean,
  repost_count bigint,
  new_balance numeric,
  shells_spent_total numeric,
  created_message jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_message public.messages%rowtype;
  account public.user_balances%rowtype;
  inserted_message public.messages%rowtype;
  existing_repost public.messages%rowtype;
  original_target_id uuid;
  normalized_media jsonb := coalesce(p_media, '[]'::jsonb);
  media_item jsonb;
  byte_count bigint;
  cleaned_quote text := nullif(btrim(coalesce(p_quote_content, '')), '');
  billed_character_count integer := 0;
  text_cost numeric := 0;
  media_cost numeric := 0;
  repost_cost numeric := 0;
  lock_result record;
  media_release record;
  final_balance numeric;
  final_spent numeric;
begin
  if jsonb_typeof(normalized_media) <> 'array'
    or jsonb_array_length(normalized_media) > 3 then
    raise exception 'Médias de citation invalides';
  end if;
  if char_length(coalesce(p_quote_content, '')) > 1000 then
    raise exception 'La citation ne peut pas dépasser 1000 caractères';
  end if;

  for media_item in select value from jsonb_array_elements(normalized_media)
  loop
    if jsonb_typeof(media_item) <> 'object'
      or not (media_item ? 'bytes')
      or (media_item ->> 'bytes') !~ '^[0-9]+$' then
      raise exception 'Taille de photo invalide';
    end if;
    byte_count := (media_item ->> 'bytes')::bigint;
    if byte_count < 1 or byte_count > 614400 then
      raise exception 'Taille de photo invalide';
    end if;
    media_cost := media_cost + ceil(byte_count::numeric / 1024);
  end loop;

  select * into target_message from public.messages
  where id = p_target_message_id and deleted_at is null;
  if not found then raise exception 'Publication introuvable'; end if;

  original_target_id := coalesce(target_message.repost_of, target_message.id);
  if original_target_id <> target_message.id then
    select * into target_message from public.messages
    where id = original_target_id and deleted_at is null;
    if not found then raise exception 'Publication originale introuvable'; end if;
  end if;
  if target_message.bitcoin_address = p_bitcoin_address then
    raise exception 'Vous ne pouvez pas reposter votre propre publication';
  end if;

  select * into account from public.user_balances
  where bitcoin_address = p_bitcoin_address for update;
  if not found then raise exception 'Utilisateur non trouvé'; end if;

  -- Only a request without quote text and without new media toggles the
  -- existing simple repost. An image-only request is a quoted repost.
  if cleaned_quote is null and jsonb_array_length(normalized_media) = 0 then
    select * into existing_repost from public.messages
    where bitcoin_address = p_bitcoin_address
      and repost_of = original_target_id
      and repost_kind = 'simple'
      and deleted_at is null
    limit 1 for update;
    if found then
      update public.messages set deleted_at = now() where id = existing_repost.id;
      select * into lock_result from private.set_refundable_shell_lock(
        p_bitcoin_address, 'message_text', existing_repost.id::text, 0
      );
      select * into media_release from private.set_refundable_shell_lock(
        p_bitcoin_address, 'message_media', existing_repost.id::text, 0
      );
      return query select false,
        (select count(*) from public.messages where repost_of = original_target_id and deleted_at is null),
        media_release.new_balance, media_release.shells_spent_total, null::jsonb;
      return;
    end if;
  end if;

  billed_character_count := char_length(replace(coalesce(target_message.content, ''), E'\n', ''))
    + char_length(replace(coalesce(cleaned_quote, ''), E'\n', ''));
  text_cost := billed_character_count;
  repost_cost := text_cost + media_cost;
  if account.shells_balance < repost_cost then raise exception 'INSUFFICIENT_SHELLS'; end if;

  insert into public.messages (
    bitcoin_address, content, char_count, cost_shells, media, created_at,
    repost_of, repost_kind
  ) values (
    p_bitcoin_address, coalesce(cleaned_quote, ''), billed_character_count,
    repost_cost, normalized_media, now(), original_target_id,
    case
      when cleaned_quote is null and jsonb_array_length(normalized_media) = 0 then 'simple'
      else 'quote'
    end
  ) returning * into inserted_message;

  final_balance := account.shells_balance;
  final_spent := coalesce(account.shells_spent_total, 0);
  if text_cost > 0 then
    select * into lock_result from private.set_refundable_shell_lock(
      p_bitcoin_address, 'message_text', inserted_message.id::text, text_cost
    );
    final_balance := lock_result.new_balance;
    final_spent := lock_result.shells_spent_total;
  end if;
  if media_cost > 0 then
    select * into lock_result from private.set_refundable_shell_lock(
      p_bitcoin_address, 'message_media', inserted_message.id::text, media_cost
    );
    final_balance := lock_result.new_balance;
    final_spent := lock_result.shells_spent_total;
  end if;

  return query select true,
    (select count(*) from public.messages where repost_of = original_target_id and deleted_at is null),
    final_balance, final_spent, to_jsonb(inserted_message);
end;
$$;

revoke all on function public.toggle_or_create_message_repost(text, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.toggle_or_create_message_repost(text, uuid, text, jsonb)
  to service_role;
