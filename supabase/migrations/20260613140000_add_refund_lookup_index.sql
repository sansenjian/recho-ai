-- Add an index to support efficient lookup of existing refunds per transaction.
-- This backs the application-level cumulative refund check in RefundCredits.
-- Note: we intentionally use a NON-unique index because multiple partial refunds
-- for the same original transaction are allowed (as long as cumulative total <= original amount).

CREATE INDEX IF NOT EXISTS idx_credit_txns_refund_lookup
  ON public.credit_transactions (related_transaction_id, reason)
  WHERE reason = 'refund'
    AND related_transaction_id IS NOT NULL;

COMMENT ON INDEX public.idx_credit_txns_refund_lookup IS
  'Supports cumulative refund lookups: allows multiple partial refunds per transaction while enabling efficient SUM queries for double-refund protection.';
