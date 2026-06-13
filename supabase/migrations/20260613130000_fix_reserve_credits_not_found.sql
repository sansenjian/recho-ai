-- Fix reserve_user_credits: replace SELECT FOR UPDATE + UPDATE two-step pattern with a
-- single atomic UPDATE. This eliminates the TOCTOU window that could trigger
-- credit_balance_not_found even when a balance row exists, and removes the
-- misleading v_current_balance := 0 fallback that could allow a zero-balance user
-- to bypass the insufficient_credits guard under certain execution paths.

drop function if exists public.reserve_user_credits(uuid, numeric, jsonb);

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

  -- Single atomic UPDATE: deduct only when the row exists AND balance is sufficient.
  -- If the row does not exist, UPDATE matches zero rows → not found → no balance record.
  -- If balance would go negative after deduction, we catch that below.
  update public.user_credit_balances
     set balance      = balance - v_amount,
         total_spent  = total_spent + v_amount,
         updated_at   = now()
   where user_id = p_user_id
     and balance >= v_amount
  returning public.user_credit_balances.balance into v_balance;

  if not found then
    -- Row does not exist, or balance was insufficient — either way the reservation fails.
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
    v_balance,
    'image_generation',
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_transaction_id;

  return query select v_balance, v_transaction_id;
end;
$$;

revoke all on function public.reserve_user_credits(uuid, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_user_credits(uuid, numeric, jsonb) to service_role;

comment on function public.reserve_user_credits(uuid, numeric, jsonb)
  is 'Gateway-only credit reservation for private image generation. Uses a single atomic UPDATE to avoid TOCTOU races. Amount supports two decimal places.';
