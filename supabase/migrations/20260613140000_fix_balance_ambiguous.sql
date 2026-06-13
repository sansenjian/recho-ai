-- Fix ambiguous column reference in reserve_user_credits
-- The variable name v_balance conflicts with the table column name balance

drop function if exists public.reserve_user_credits(uuid, numeric, jsonb);

create or replace function public.reserve_user_credits(
  p_user_id uuid,
  p_amount numeric,
  p_metadata jsonb default '{}'::jsonb
)
returns table(new_balance numeric, transaction_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(12,2);
  v_new_balance numeric(12,2);
  v_transaction_id uuid;
begin
  if p_user_id is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;

  v_amount := round(coalesce(p_amount, 0), 2);
  if v_amount <= 0 then
    raise exception 'invalid_credit_amount' using errcode = 'P0001';
  end if;

  update public.user_credit_balances
     set balance      = public.user_credit_balances.balance - v_amount,
         total_spent  = public.user_credit_balances.total_spent + v_amount,
         updated_at   = now()
   where user_id = p_user_id
     and public.user_credit_balances.balance >= v_amount
  returning public.user_credit_balances.balance into v_new_balance;

  if not found then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

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
    v_new_balance,
    'image_generation',
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_transaction_id;

  return query select v_new_balance, v_transaction_id;
end;
$$;

revoke all on function public.reserve_user_credits(uuid, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_user_credits(uuid, numeric, jsonb) to service_role;

comment on function public.reserve_user_credits(uuid, numeric, jsonb)
  is 'Gateway-only credit reservation for private image generation. Uses a single atomic UPDATE to avoid TOCTOU races. Amount supports two decimal places.';
