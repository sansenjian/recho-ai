-- Idempotency keys table for credit-consuming endpoints.
-- Prevents double-charging when clients retry requests (e.g., network timeout).
--
-- Flow:
--   1. Handler calls Acquire(user_id, idem_key, scope, fingerprint)
--      -> INSERT 'processing' ON CONFLICT DO NOTHING
--      -> If conflict: compare fingerprint → replay or 409
--   2. Handler processes the request (reserve credits, call API, etc.)
--   3. Handler calls Complete with response body + transaction_id
--      -> UPDATE to 'completed', store response
--   4. On retry: Acquire finds 'completed' with matching fingerprint → replay cached response
--
-- Stale 'processing' records (>5 min) are treated as failed to handle crashes.

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    idem_key        TEXT NOT NULL,
    scope           TEXT NOT NULL CHECK (scope IN ('image_generate', 'credit_redeem')),
    request_hash    TEXT NOT NULL,           -- SHA-256 hex of raw request body
    status          TEXT NOT NULL DEFAULT 'processing'
                        CHECK (status IN ('processing', 'completed', 'failed')),
    response_code   SMALLINT,                -- HTTP status of cached response
    response_body   JSONB,                   -- cached JSON response for replay
    transaction_id  TEXT,                    -- linked credit_transaction id (if any)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
    UNIQUE (user_id, idem_key, scope)
);

-- Cleanup of expired records
CREATE INDEX IF NOT EXISTS idx_idempotency_expires
    ON public.idempotency_keys (expires_at)
    WHERE status != 'processing';

COMMENT ON TABLE public.idempotency_keys IS
    'Request-level idempotency for credit-consuming endpoints. Prevents double-charging on client retries.';
