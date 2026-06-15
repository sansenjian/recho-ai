create extension if not exists "hypopg" with schema "extensions";

create extension if not exists "index_advisor" with schema "extensions";

drop extension if exists "pg_net";

drop function if exists "public"."admin_image_storage_overview"();

drop function if exists "public"."admin_user_generation_stats"(p_user_ids uuid[], p_since timestamp with time zone);

drop function if exists "public"."parse_size_to_bytes"(size_str text);

drop function if exists "public"."reserve_user_credits"(p_user_id uuid, p_amount numeric, p_metadata jsonb);

drop index if exists "public"."announcements_status_published_at_idx";

drop index if exists "public"."image_generation_attempts_user_id_created_at_status_idx";

drop index if exists "public"."image_generations_storage_path_idx";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name = 'public' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reserve_user_credits(p_user_id uuid, p_amount numeric, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(balance numeric, transaction_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  return query select v_new_balance as balance, v_transaction_id as transaction_id;
end;
$function$
;
