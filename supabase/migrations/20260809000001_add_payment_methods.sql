-- Converted from db/policies/add_payment_methods.sql (kept there for history).
-- Add payment method handles to the User table, so members can pay each
-- other back through a real app (Venmo/Cash App/PayPal/Zelle) instead of
-- cash or a bank transfer typed in blind. Dues stays "unofficial" — it never
-- moves money itself, these are just the handles used to build outbound
-- deep links (see src/lib/paymentLinks.ts).

ALTER TABLE public."User"
ADD COLUMN IF NOT EXISTS venmo_username character varying,
ADD COLUMN IF NOT EXISTS cashapp_cashtag character varying,
ADD COLUMN IF NOT EXISTS paypal_username character varying,
ADD COLUMN IF NOT EXISTS zelle_handle character varying;

-- No new RLS policies needed — "Users can read all profiles" (broad SELECT)
-- and "Users can update own profile" (self-only UPDATE), both already in
-- 20260807000001_lockdown_rls.sql, cover these columns the same as first_name/last_name.
