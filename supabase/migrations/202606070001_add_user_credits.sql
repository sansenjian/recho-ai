alter table public.image_generations
  add column if not exists visibility text not null default 'public',
  add column if not exists funding_source text not null default 'free',
  add column if not exists credit_cost integer not null default 0;

alter table public.image_generations
  drop constraint if exists image_generations_visibility_check,
  add constraint image_generations_visibility_check
    check (visibility in ('public', 'private'));

alter table public.image_generations
  drop constraint if exists image_generations_funding_source_check,
  add constraint image_generations_funding_source_check
    check (funding_source in ('free', 'credit'));

alter table public.image_generations
  drop constraint if exists image_generations_credit_cost_check,
  add constraint image_generations_credit_cost_check
    check (credit_cost >= 0);

create index if not exists image_generations_visibility_generated_at_idx
  on public.image_generations (visibility, generated_at desc);

create table if not exists public.user_credit_balances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0,
  total_redeemed integer not null default 0,
  total_spent integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_credit_balances_balance_check check (balance >= 0),
  constraint user_credit_balances_total_redeemed_check check (total_redeemed >= 0),
  constraint user_credit_balances_total_spent_check check (total_spent >= 0)
);

create table if not exists public.credit_redemption_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  credits integer not null,
  max_redemptions integer not null default 1,
  redeemed_count integer not null default 0,
  expires_at timestamptz,
  disabled_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  constraint credit_redemption_codes_code_hash_check check (code_hash ~ '^[a-f0-9]{64}$'),
  constraint credit_redemption_codes_credits_check check (credits > 0),
  constraint credit_redemption_codes_max_redemptions_check check (max_redemptions > 0),
  constraint credit_redemption_codes_redeemed_count_check check (redeemed_count >= 0 and redeemed_count <= max_redemptions)
);

create table if not exists public.credit_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.credit_redemption_codes(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  credits integer not null,
  redeemed_at timestamptz not null default now(),
  constraint credit_redemptions_credits_check check (credits > 0),
  constraint credit_redemptions_code_user_unique unique (code_id, user_id)
);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null,
  balance_after integer not null,
  reason text not null,
  redemption_id uuid references public.credit_redemptions(id) on delete set null,
  related_transaction_id uuid references public.credit_transactions(id) on delete set null,
  generation_id text references public.image_generations(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint credit_transactions_amount_check check (amount <> 0),
  constraint credit_transactions_balance_after_check check (balance_after >= 0),
  constraint credit_transactions_reason_check check (reason in ('redemption', 'image_generation', 'refund'))
);

alter table public.image_generations
  add column if not exists credit_transaction_id uuid references public.credit_transactions(id) on delete set null;

alter table public.user_credit_balances enable row level security;
alter table public.credit_redemption_codes enable row level security;
alter table public.credit_redemptions enable row level security;
alter table public.credit_transactions enable row level security;

revoke all on table public.user_credit_balances from anon, authenticated, public;
revoke all on table public.credit_redemption_codes from anon, authenticated, public;
revoke all on table public.credit_redemptions from anon, authenticated, public;
revoke all on table public.credit_transactions from anon, authenticated, public;

grant select, insert, update, delete on table public.user_credit_balances to service_role;
grant select, insert, update, delete on table public.credit_redemption_codes to service_role;
grant select, insert, update, delete on table public.credit_redemptions to service_role;
grant select, insert, update, delete on table public.credit_transactions to service_role;

drop policy if exists "Service role manages user credit balances" on public.user_credit_balances;
create policy "Service role manages user credit balances"
  on public.user_credit_balances
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role manages credit redemption codes" on public.credit_redemption_codes;
create policy "Service role manages credit redemption codes"
  on public.credit_redemption_codes
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role manages credit redemptions" on public.credit_redemptions;
create policy "Service role manages credit redemptions"
  on public.credit_redemptions
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role manages credit transactions" on public.credit_transactions;
create policy "Service role manages credit transactions"
  on public.credit_transactions
  for all
  to service_role
  using (true)
  with check (true);

create index if not exists user_credit_balances_updated_at_idx
  on public.user_credit_balances (updated_at desc);

create index if not exists credit_redemption_codes_code_hash_idx
  on public.credit_redemption_codes (code_hash);

create index if not exists credit_redemptions_user_redeemed_at_idx
  on public.credit_redemptions (user_id, redeemed_at desc);

create index if not exists credit_transactions_user_created_at_idx
  on public.credit_transactions (user_id, created_at desc);

create index if not exists credit_transactions_related_transaction_idx
  on public.credit_transactions (related_transaction_id);

create or replace function public.redeem_credit_code(
  p_user_id uuid,
  p_code_hash text
)
returns table(balance integer, credits integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.credit_redemption_codes%rowtype;
  v_balance integer;
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
  p_amount integer,
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
  if p_user_id is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;

  if p_amount is null or p_amount <= 0 then
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

  if v_current_balance < p_amount then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

  update public.user_credit_balances
     set balance = balance - p_amount,
         total_spent = total_spent + p_amount,
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
    -p_amount,
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
  p_amount integer,
  p_related_transaction_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table(balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_original_amount integer;
  v_already_refunded integer;
  v_refund_amount integer;
begin
  if p_user_id is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_credit_amount' using errcode = 'P0001';
  end if;

  v_refund_amount := p_amount;

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

      v_refund_amount := least(p_amount, greatest(v_original_amount - v_already_refunded, 0));
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

  insert into public.user_credit_balances (user_id, balance, updated_at)
  values (p_user_id, v_refund_amount, now())
  on conflict (user_id) do update
     set balance = public.user_credit_balances.balance + excluded.balance,
         total_spent = greatest(public.user_credit_balances.total_spent - excluded.balance, 0),
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

revoke all on function public.redeem_credit_code(uuid, text) from public, anon, authenticated;
revoke all on function public.reserve_user_credits(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.refund_user_credits(uuid, integer, uuid, jsonb) from public, anon, authenticated;

grant execute on function public.redeem_credit_code(uuid, text) to service_role;
grant execute on function public.reserve_user_credits(uuid, integer, jsonb) to service_role;
grant execute on function public.refund_user_credits(uuid, integer, uuid, jsonb) to service_role;

comment on column public.image_generations.visibility is 'Controls whether a generation appears in the public works gallery.';
comment on column public.image_generations.funding_source is 'How the generation was funded. Credit-funded generations remain private.';
comment on column public.image_generations.credit_cost is 'Credits charged for this generated image row.';
comment on column public.image_generations.credit_transaction_id is 'Credit transaction that funded this generated image when applicable.';
comment on table public.user_credit_balances is 'Gateway-only per-user image generation credit balances.';
comment on table public.credit_redemption_codes is 'Gateway-only redemption code inventory. Stores code hashes, not raw codes.';
comment on table public.credit_redemptions is 'Gateway-only redemption audit log.';
comment on table public.credit_transactions is 'Gateway-only credit ledger for redemptions, generation charges, and refunds.';
