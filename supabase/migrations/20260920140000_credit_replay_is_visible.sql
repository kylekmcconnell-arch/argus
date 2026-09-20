-- A replayed credit key must announce itself.
--
-- consume_investigation_credit returned allowed=true for any key this
-- organization had already paid for, with no way for the caller to tell a
-- fresh debit from a replay. The receipt ledger is what actually stops a
-- replayed key from starting a second collector run, but the credit path
-- should not be silently handing out free passes either: a caller that
-- cannot see the replay cannot refuse it (#355).
--
-- Adding a column to the returned table is backwards compatible for callers
-- that select specific fields; the two existing callers read `allowed` and
-- `balance_millis` by name.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

drop function if exists public.consume_investigation_credit(uuid, uuid, text, bigint);

create or replace function public.consume_investigation_credit(
  p_organization_id uuid,
  p_user_id uuid,
  p_idempotency_key text,
  p_cost_millis bigint default 1000
)
returns table(allowed boolean, balance_millis bigint, replayed boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_balance bigint;
  v_existing bigint;
begin
  if p_cost_millis < 1 or p_cost_millis > 100000 then
    raise exception 'invalid credit cost';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 then
    raise exception 'invalid credit idempotency key';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_organization_id::text),
    hashtext(p_user_id::text)
  );

  select amount_millis
    into v_existing
  from public.credit_ledger
  where organization_id = p_organization_id
    and idempotency_key = p_idempotency_key
  limit 1;

  if v_existing is not null then
    select coalesce(sum(amount_millis), 0)
      into v_balance
    from public.credit_ledger
    where organization_id = p_organization_id
      and user_id = p_user_id;
    -- Replay of a key this organization already paid for. It is allowed,
    -- and it is NOT a second charge, so the caller must be told: a caller
    -- that starts fresh work on a replayed key is spending one credit
    -- twice.
    return query select true, v_balance, true;
    return;
  end if;

  select coalesce(sum(amount_millis), 0)
    into v_balance
  from public.credit_ledger
  where organization_id = p_organization_id
    and user_id = p_user_id;

  if v_balance < p_cost_millis then
    return query select false, v_balance, false;
    return;
  end if;

  insert into public.credit_ledger (
    organization_id, user_id, amount_millis, reason, idempotency_key, metadata
  ) values (
    p_organization_id,
    p_user_id,
    -p_cost_millis,
    'investigation_debit',
    p_idempotency_key,
    jsonb_build_object('userId', p_user_id)
  );

  return query select true, v_balance - p_cost_millis, false;
end;
$$;

-- `drop function` discards the grants the original migration set, which would
-- leave the recreated function executable by PUBLIC. Restore the service-role
-- boundary in the same transaction so the credit ledger is never briefly
-- callable by anon or authenticated.
revoke all on function public.consume_investigation_credit(uuid, uuid, text, bigint)
  from public, anon, authenticated;

grant execute on function public.consume_investigation_credit(uuid, uuid, text, bigint)
  to service_role;

comment on function public.consume_investigation_credit(uuid, uuid, text, bigint) is
  'Debits one investigation credit. Returns replayed=true when the key was already paid for, so callers can refuse to start new work on it.';

commit;
