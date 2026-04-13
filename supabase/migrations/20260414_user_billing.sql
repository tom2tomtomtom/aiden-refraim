-- User billing table for Stripe integration
CREATE TABLE IF NOT EXISTS public.user_billing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  subscription_status TEXT DEFAULT 'inactive',
  exports_this_month INTEGER NOT NULL DEFAULT 0,
  exports_reset_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_billing_user_id ON public.user_billing(user_id);
CREATE INDEX IF NOT EXISTS idx_user_billing_stripe_customer ON public.user_billing(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_user_billing_stripe_sub ON public.user_billing(stripe_subscription_id);

ALTER TABLE public.user_billing ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own billing' AND tablename = 'user_billing') THEN
    CREATE POLICY "Users can view own billing" ON public.user_billing
      FOR SELECT TO authenticated USING (user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert own billing' AND tablename = 'user_billing') THEN
    CREATE POLICY "Users can insert own billing" ON public.user_billing
      FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access to billing' AND tablename = 'user_billing') THEN
    CREATE POLICY "Service role full access to billing" ON public.user_billing
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_user_billing_updated_at') THEN
    CREATE TRIGGER update_user_billing_updated_at
      BEFORE UPDATE ON public.user_billing
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
