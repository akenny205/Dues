-- Lets the payer tag a recorded payment (Session.is_payment = true) with how
-- they actually sent the money — Venmo/Cash App/PayPal/Zelle, or Cash for
-- when nothing moved through an app at all. Purely descriptive: it doesn't
-- change how balances are calculated, just what shows on the payment while
-- it's waiting for the other person to confirm and afterward.
ALTER TABLE public."Session"
ADD COLUMN IF NOT EXISTS payment_method character varying;
