-- Keep the atomic image-job start RPC independent of the output column names
-- exposed by reserve_user_credits. Production databases may retain compatible
-- signatures with different OUT parameter names, so alias them at the call
-- site before reading the result.

create or replace function public.start_image_generation_job(
  p_user_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_generation_batch_id text,
  p_request_id text,
  p_requested_count integer,
  p_reserved_amount numeric,
  p_credit_metadata jsonb default '{}'::jsonb,
  p_result_manifest jsonb default '{}'::jsonb,
  p_lock_owner text default '',
  p_lease_seconds integer default 600
)
returns table(
  job_id uuid,
  status text,
  lease_token uuid,
  locked_until timestamptz,
  balance numeric,
  transaction_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_idempotency_id uuid;
  v_request_hash text;
  v_idempotency_status text;
  v_existing_job_id uuid;
  v_existing_status text;
  v_existing_lease_token uuid;
  v_existing_locked_until timestamptz;
  v_existing_transaction_id uuid;
  v_balance numeric;
  v_transaction_id uuid;
begin
  if p_user_id is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_idem_key, '')), '') is null then
    raise exception 'idempotency_key_required' using errcode = 'P0001';
  end if;
  if p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_request_hash' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_generation_batch_id, '')), '') is null
     or nullif(trim(coalesce(p_request_id, '')), '') is null
     or nullif(trim(coalesce(p_lock_owner, '')), '') is null then
    raise exception 'invalid_image_job_identity' using errcode = 'P0001';
  end if;
  if p_requested_count <= 0 then
    raise exception 'invalid_image_count' using errcode = 'P0001';
  end if;
  if round(coalesce(p_reserved_amount, 0), 2) <= 0 then
    raise exception 'invalid_credit_amount' using errcode = 'P0001';
  end if;

  -- Lock the idempotency row before checking/reusing the job. Acquire() has
  -- already created this row in processing state.
  select ik.id, ik.request_hash, ik.status
    into v_idempotency_id, v_request_hash, v_idempotency_status
    from public.idempotency_keys as ik
   where ik.user_id = p_user_id
     and ik.idem_key = p_idem_key
     and ik.scope = 'image_generate'
   for update;

  if not found then
    raise exception 'idempotency_not_found' using errcode = 'P0001';
  end if;
  if v_request_hash <> p_request_hash then
    raise exception 'idempotency_conflict' using errcode = 'P0001';
  end if;
  if v_idempotency_status <> 'processing' then
    raise exception 'idempotency_not_processing' using errcode = 'P0001';
  end if;

  -- A retry after a committed RPC must return the original job and must not
  -- reserve credits again.
  select j.id, j.status, j.lease_token, j.locked_until, j.credit_transaction_id
    into v_existing_job_id, v_existing_status, v_existing_lease_token,
         v_existing_locked_until, v_existing_transaction_id
    from public.image_generation_jobs as j
   where j.user_id = p_user_id
     and j.idempotency_key = p_idem_key
     and j.request_hash = p_request_hash
   order by j.created_at desc
   limit 1
   for update;

  if found then
    select coalesce(ucb.balance, 0)
      into v_balance
      from public.user_credit_balances ucb
     where ucb.user_id = p_user_id;
    return query
      select v_existing_job_id,
             v_existing_status,
             v_existing_lease_token,
             v_existing_locked_until,
             coalesce(v_balance, 0),
             v_existing_transaction_id;
    return;
  end if;

  select reservation.reserved_balance,
         reservation.reserved_transaction_id
    into v_balance, v_transaction_id
    from public.reserve_user_credits(
      p_user_id,
      round(p_reserved_amount, 2),
      coalesce(p_credit_metadata, '{}'::jsonb)
    ) as reservation(reserved_balance, reserved_transaction_id);

  insert into public.image_generation_jobs (
    generation_batch_id,
    request_id,
    user_id,
    idempotency_key,
    request_hash,
    status,
    credit_transaction_id,
    reserved_amount,
    requested_count,
    returned_count,
    max_attempts,
    result_manifest,
    locked_by,
    lease_token,
    locked_until
  )
  values (
    p_generation_batch_id,
    p_request_id,
    p_user_id,
    p_idem_key,
    p_request_hash,
    'staging',
    v_transaction_id,
    round(p_reserved_amount, 2),
    p_requested_count,
    0,
    5,
    coalesce(p_result_manifest, '{}'::jsonb),
    p_lock_owner,
    gen_random_uuid(),
    now() + make_interval(secs => greatest(p_lease_seconds, 1))
  )
  returning image_generation_jobs.id,
            image_generation_jobs.status,
            image_generation_jobs.lease_token,
            image_generation_jobs.locked_until
    into v_existing_job_id, v_existing_status, v_existing_lease_token,
         v_existing_locked_until;

  update public.idempotency_keys as ik
     set transaction_id = v_transaction_id
   where ik.id = v_idempotency_id
     and ik.status = 'processing';

  return query
    select v_existing_job_id,
           v_existing_status,
           v_existing_lease_token,
           v_existing_locked_until,
           v_balance,
           v_transaction_id;
end;
$$;

revoke all on function public.start_image_generation_job(
  uuid, text, text, text, text, integer, numeric, jsonb, jsonb, text, integer
) from public, anon, authenticated;
grant execute on function public.start_image_generation_job(
  uuid, text, text, text, text, integer, numeric, jsonb, jsonb, text, integer
) to service_role;

comment on function public.start_image_generation_job(
  uuid, text, text, text, text, integer, numeric, jsonb, jsonb, text, integer
) is 'Atomically binds a processing idempotency claim, image credit reservation, and durable staging job.';
