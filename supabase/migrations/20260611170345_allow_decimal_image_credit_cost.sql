drop function if exists public.redeem_credit_code(uuid, text);
drop function if exists public.reserve_user_credits(uuid, integer, jsonb);
drop function if exists public.refund_user_credits(uuid, integer, uuid, jsonb);
drop function if exists public.adjust_user_credits(uuid, integer, uuid, text, jsonb);
drop function if exists public.reserve_user_credits(uuid, numeric, jsonb);
drop function if exists public.refund_user_credits(uuid, numeric, uuid, jsonb);
drop function if exists public.adjust_user_credits(uuid, numeric, uuid, text, jsonb);

alter table public.image_generations
  alter column credit_cost type numeric(12,2) using round(coalesce(credit_cost, 0)::numeric, 2),
  alter column credit_cost set default 0;

alter table public.user_credit_balances
  alter column balance type numeric(12,2) using round(coalesce(balance, 0)::numeric, 2),
  alter column total_redeemed type numeric(12,2) using round(coalesce(total_redeemed, 0)::numeric, 2),
  alter column total_spent type numeric(12,2) using round(coalesce(total_spent, 0)::numeric, 2),
  alter column balance set default 0,
  alter column total_redeemed set default 0,
  alter column total_spent set default 0;

alter table public.credit_transactions
  alter column amount type numeric(12,2) using round(coalesce(amount, 0)::numeric, 2),
  alter column balance_after type numeric(12,2) using round(coalesce(balance_after, 0)::numeric, 2);

create or replace function public.redeem_credit_code(
  p_user_id uuid,
  p_code_hash text
)
returns table(balance numeric, credits integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.credit_redemption_codes%rowtype;
  v_balance numeric(12,2);
  v_redemption_id uuid;
begin
  if p_user_id is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;

  if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;

  select *
    into v_code
    from public.credit_redemption_codes
   where code_hash = p_code_hash
   for update;

  if not found then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;

  if v_code.disabled_at is not null then
    raise exception 'code_disabled' using errcode = 'P0001';
  end if;

  if v_code.expires_at is not null and v_code.expires_at <= now() then
    raise exception 'code_expired' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.credit_redemptions
     where code_id = v_code.id
       and user_id = p_user_id
  ) then
    raise exception 'code_already_redeemed' using errcode = 'P0001';
  end if;

  if v_code.redeemed_count >= v_code.max_redemptions then
    raise exception 'code_exhausted' using errcode = 'P0001';
  end if;

  update public.credit_redemption_codes
     set redeemed_count = redeemed_count + 1
   where id = v_code.id;

  insert into public.credit_redemptions (code_id, user_id, credits)
  values (v_code.id, p_user_id, v_code.credits)
  returning id into v_redemption_id;

  insert into public.user_credit_balances (user_id, balance, total_redeemed, updated_at)
  values (p_user_id, v_code.credits, v_code.credits, now())
  on conflict (user_id) do update
     set balance = public.user_credit_balances.balance + excluded.balance,
         total_redeemed = public.user_credit_balances.total_redeemed + excluded.total_redeemed,
         updated_at = now()
  returning public.user_credit_balances.balance into v_balance;

  insert into public.credit_transactions (
    user_id,
    amount,
    balance_after,
    reason,
    redemption_id,
    metadata
  )
  values (
    p_user_id,
    v_code.credits,
    v_balance,
    'redemption',
    v_redemption_id,
    jsonb_build_object('code_id', v_code.id)
  );

  return query select v_balance, v_code.credits;
end;
$$;

create or replace function public.reserve_user_credits(
  p_user_id uuid,
  p_amount numeric,
  p_metadata jsonb default '{}'::jsonb
)
returns table(balance numeric, transaction_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(12,2);
  v_current_balance numeric(12,2);
  v_balance numeric(12,2);
  v_transaction_id uuid;
begin
  if p_user_id is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;

  v_amount := round(coalesce(p_amount, 0), 2);
  if v_amount <= 0 then
    raise exception 'invalid_credit_amount' using errcode = 'P0001';
  end if;

  select user_credit_balances.balance
    into v_current_balance
    from public.user_credit_balances
   where user_id = p_user_id
   for update;

  if not found then
    v_current_balance := 0;
  end if;

  if v_current_balance < v_amount then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

  update public.user_credit_balances
     set balance = balance - v_amount,
         total_spent = total_spent + v_amount,
         updated_at = now()
   where user_id = p_user_id
  returning public.user_credit_balances.balance into v_balance;

  insert into public.credit_transactions (
    user_id,
    amount,
    balance_after,
    reason,
    metadata
  )
  values (
    p_user_id,
    -v_amount,
    v_balance,
    'image_generation',
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_transaction_id;

  return query select v_balance, v_transaction_id;
end;
$$;

create or replace function public.refund_user_credits(
  p_user_id uuid,
  p_amount numeric,
  p_related_transaction_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table(balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(12,2);
  v_original_amount numeric(12,2);
  v_already_refunded numeric(12,2);
  v_refund_amount numeric(12,2);
begin
  if p_user_id is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;

  v_refund_amount := round(coalesce(p_amount, 0), 2);
  if v_refund_amount <= 0 then
    raise exception 'invalid_credit_amount' using errcode = 'P0001';
  end if;

  if p_related_transaction_id is not null then
    select -amount
      into v_original_amount
      from public.credit_transactions
     where id = p_related_transaction_id
       and user_id = p_user_id
       and reason = 'image_generation';

    if found then
      select coalesce(sum(amount), 0)
        into v_already_refunded
        from public.credit_transactions
       where reason = 'refund'
         and related_transaction_id = p_related_transaction_id
         and user_id = p_user_id;

      v_refund_amount := least(v_refund_amount, greatest(v_original_amount - v_already_refunded, 0));
      if v_refund_amount <= 0 then
        select user_credit_balances.balance
          into v_balance
          from public.user_credit_balances
         where user_id = p_user_id;
        return query select coalesce(v_balance, 0);
        return;
      end if;
    end if;
  end if;

  insert into public.user_credit_balances (user_id, balance, total_redeemed, updated_at)
  values (p_user_id, v_refund_amount, 0, now())
  on conflict (user_id) do update
     set balance = public.user_credit_balances.balance + excluded.balance,
         total_spent = greatest(public.user_credit_balances.total_spent - excluded.balance, 0),
         total_redeemed = public.user_credit_balances.total_redeemed + excluded.total_redeemed,
         updated_at = now()
  returning public.user_credit_balances.balance into v_balance;

  insert into public.credit_transactions (
    user_id,
    amount,
    balance_after,
    reason,
    related_transaction_id,
    metadata
  )
  values (
    p_user_id,
    v_refund_amount,
    v_balance,
    'refund',
    p_related_transaction_id,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return query select v_balance;
end;
$$;

create or replace function public.adjust_user_credits(
  p_user_id uuid,
  p_amount numeric,
  p_admin_user_id uuid,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table(balance numeric, transaction_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(12,2);
  v_current_balance numeric(12,2);
  v_balance numeric(12,2);
  v_transaction_id uuid;
begin
  if p_user_id is null or p_admin_user_id is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;

  v_amount := round(coalesce(p_amount, 0), 2);
  if v_amount = 0 then
    raise exception 'invalid_credit_amount' using errcode = 'P0001';
  end if;

  if v_amount < 0 then
    select user_credit_balances.balance
      into v_current_balance
      from public.user_credit_balances
     where user_id = p_user_id
     for update;

    if not found or v_current_balance + v_amount < 0 then
      raise exception 'insufficient_credits' using errcode = 'P0001';
    end if;
  end if;

  insert into public.user_credit_balances (user_id, balance, updated_at)
  values (p_user_id, v_amount, now())
  on conflict (user_id) do update
     set balance = public.user_credit_balances.balance + excluded.balance,
         updated_at = now()
  returning public.user_credit_balances.balance into v_balance;

  insert into public.credit_transactions (
    user_id,
    amount,
    balance_after,
    reason,
    metadata
  )
  values (
    p_user_id,
    v_amount,
    v_balance,
    'admin_adjustment',
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'note', nullif(trim(coalesce(p_note, '')), '')
    ) || coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_transaction_id;

  return query select v_balance, v_transaction_id;
end;
$$;

revoke all on function public.redeem_credit_code(uuid, text) from public, anon, authenticated;
revoke all on function public.reserve_user_credits(uuid, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.refund_user_credits(uuid, numeric, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.adjust_user_credits(uuid, numeric, uuid, text, jsonb) from public, anon, authenticated;

grant execute on function public.redeem_credit_code(uuid, text) to service_role;
grant execute on function public.reserve_user_credits(uuid, numeric, jsonb) to service_role;
grant execute on function public.refund_user_credits(uuid, numeric, uuid, jsonb) to service_role;
grant execute on function public.adjust_user_credits(uuid, numeric, uuid, text, jsonb) to service_role;

comment on column public.image_generations.credit_cost is 'Credits charged for this generated image row. Supports decimal prices.';
comment on function public.reserve_user_credits(uuid, numeric, jsonb)
  is 'Gateway-only credit reservation for private image generation. Amount supports two decimal places.';
comment on function public.refund_user_credits(uuid, numeric, uuid, jsonb)
  is 'Gateway-only credit refund for failed or partial image generation. Amount supports two decimal places.';
comment on function public.adjust_user_credits(uuid, numeric, uuid, text, jsonb)
  is 'Gateway-only admin credit adjustment with an auditable credit transaction. Amount supports two decimal places.';
