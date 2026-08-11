-- Lets a user mark which of their saved payment handles (Venmo/Cash App/
-- PayPal/Zelle, added in 20260809000001_add_payment_methods.sql) is their
-- preferred one, so callers building pay-link UI (see getPayLinks in
-- src/lib/paymentLinks.ts) can put it first instead of always using the
-- fixed venmo/cashapp/paypal order.

ALTER TABLE public."User"
ADD COLUMN IF NOT EXISTS preferred_payment_method character varying;

-- Whatever's stored here is just a UI hint, not a foreign key into a fixed
-- list — but it should still only ever be one of the four methods that
-- actually exist, or unset.
ALTER TABLE public."User" DROP CONSTRAINT IF EXISTS user_preferred_payment_method_check;
ALTER TABLE public."User"
ADD CONSTRAINT user_preferred_payment_method_check
  CHECK (preferred_payment_method IS NULL OR preferred_payment_method IN ('venmo', 'cashapp', 'paypal', 'zelle'));

-- No new RLS policies needed — same broad-read/self-write columns as the
-- other payment method fields, already covered by the policies in
-- 20260807000001_lockdown_rls.sql.
