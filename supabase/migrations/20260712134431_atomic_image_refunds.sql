-- Serialize refunds for the same image-generation transaction.
--
-- The previous implementation calculated SUM(refund) and inserted the next
-- refund without a lock spanning both operations. Two compensation workers
-- could therefore observe the same remaining amount and both credit it. An
-- advisory transaction lock keyed by the related transaction UUID keeps the
-- cumulative cap atomic without changing the public RPC signature.

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
    -- Advisory locks are transaction-scoped and serialize the SUM + INSERT
    -- pair even when multiple Worker processes refund the same job.
    perform pg_advisory_xact_lock(
      hashtextextended(p_related_transaction_id::text, 0)
    );

    select -amount
      into v_original_amount
      from public.credit_transactions
     where id = p_related_transaction_id
       and user_id = p_user_id
       and reason = 'image_generation';

    if not found then
      raise exception 'credit_transaction_not_found' using errcode = 'P0001';
    end if;

    select coalesce(sum(amount), 0)
      into v_already_refunded
      from public.credit_transactions
     where reason = 'refund'
       and related_transaction_id = p_related_transaction_id
       and user_id = p_user_id;

    v_refund_amount := least(
      v_refund_amount,
      greatest(v_original_amount - v_already_refunded, 0)
    );
    if v_refund_amount <= 0 then
      select user_credit_balances.balance
        into v_balance
        from public.user_credit_balances
       where user_id = p_user_id;
      return query select coalesce(v_balance, 0);
      return;
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

revoke all on function public.refund_user_credits(uuid, numeric, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.refund_user_credits(uuid, numeric, uuid, jsonb)
  to service_role;

comment on function public.refund_user_credits(uuid, numeric, uuid, jsonb)
  is 'Gateway-only image credit refund with transaction-scoped locking to enforce the cumulative refund cap atomically.';
