-- Comments use the same optimized R2 media pipeline and refundable KiB billing
-- as top-level publications. The parent relationship changes presentation only;
-- it must not change media validation, charging or deletion refunds.

create or replace function public.publish_message_with_media_cost(
  p_bitcoin_address text,
  p_content text,
  p_parent_id uuid default null,
  p_media jsonb default '[]'::jsonb
)
returns table (
  created_message jsonb,
  btc_balance numeric,
  new_balance numeric,
  shells_spent_total numeric,
  cost numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.user_balances%rowtype;
  inserted_message public.messages%rowtype;
  normalized_media jsonb := coalesce(p_media, '[]'::jsonb);
  media_item jsonb;
  byte_count bigint;
  character_count integer;
  text_cost numeric;
  media_cost numeric := 0;
  message_cost numeric;
  lock_result record;
  final_balance numeric;
  final_spent numeric;
begin
  if jsonb_typeof(normalized_media) <> 'array'
    or jsonb_array_length(normalized_media) > 3 then
    raise exception 'Médias du message invalides';
  end if;
  if (p_content is null or btrim(p_content) = '')
    and jsonb_array_length(normalized_media) = 0 then
    raise exception 'Le message ne peut pas être vide';
  end if;
  if char_length(coalesce(p_content, '')) > 1000 then
    raise exception 'Le message ne peut pas dépasser 1000 caractères';
  end if;
  if p_parent_id is not null and not exists (
    select 1 from public.messages where id = p_parent_id and deleted_at is null
  ) then raise exception 'Publication parente introuvable'; end if;

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

  character_count := char_length(replace(coalesce(p_content, ''), E'\n', ''));
  text_cost := character_count;
  message_cost := text_cost + media_cost;

  select * into account
  from public.user_balances
  where bitcoin_address = p_bitcoin_address
  for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;
  if account.shells_balance < message_cost then raise exception 'INSUFFICIENT_SHELLS'; end if;

  insert into public.messages (
    bitcoin_address, content, char_count, cost_shells, parent_id, media, created_at
  ) values (
    p_bitcoin_address, coalesce(p_content, ''), character_count,
    message_cost, p_parent_id, normalized_media, now()
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

  return query select
    to_jsonb(inserted_message),
    coalesce(account.btc_balance, 0),
    final_balance,
    final_spent,
    message_cost;
end;
$$;

revoke all on function public.publish_message_with_media_cost(text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_message_with_media_cost(text, text, uuid, jsonb)
  to service_role;
