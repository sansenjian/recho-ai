alter table public.credit_transactions
  drop constraint if exists credit_transactions_reason_check,
  add constraint credit_transactions_reason_check
    check (reason in ('redemption', 'image_generation', 'refund', 'admin_adjustment'));

create or replace function public.adjust_user_credits(
  p_user_id uuid,
  p_amount integer,
  p_admin_user_id uuid,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table(balance integer, transaction_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_balance integer;
  v_balance integer;
  v_transaction_id uuid;
begin
  if p_user_id is null or p_admin_user_id is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;

  if p_amount is null or p_amount = 0 then
    raise exception 'invalid_credit_amount' using errcode = 'P0001';
  end if;

  if p_amount < 0 then
    select user_credit_balances.balance
      into v_current_balance
      from public.user_credit_balances
     where user_id = p_user_id
     for update;

    if not found or v_current_balance + p_amount < 0 then
      raise exception 'insufficient_credits' using errcode = 'P0001';
    end if;
  end if;

  insert into public.user_credit_balances (user_id, balance, updated_at)
  values (p_user_id, p_amount, now())
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
    p_amount,
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

revoke all on function public.adjust_user_credits(uuid, integer, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.adjust_user_credits(uuid, integer, uuid, text, jsonb) to service_role;

comment on function public.adjust_user_credits(uuid, integer, uuid, text, jsonb)
  is 'Gateway-only admin credit adjustment with an auditable credit transaction.';
