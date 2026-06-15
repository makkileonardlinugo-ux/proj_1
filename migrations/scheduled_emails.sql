-- Run this in the Supabase SQL Editor (https://supabase.com/dashboard)
-- Project: uvcdffktunyhrrsbcpdm

CREATE TABLE IF NOT EXISTS scheduled_emails (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  label         text        NOT NULL,
  type          text        NOT NULL,   -- 'briefing' | 'product'
  product_key   text,                   -- null when type = 'briefing'
  schedule_type text        NOT NULL,   -- 'once' | 'daily' | 'weekly'
  send_hour     int         DEFAULT 8,  -- 0-23
  send_minute   int         DEFAULT 0,  -- 0-59
  send_weekday  int,                    -- 0=Sunday … 6=Saturday (weekly only)
  run_once_at   timestamptz,            -- set when schedule_type = 'once'
  next_run         timestamptz NOT NULL,
  last_run         timestamptz,
  is_active        boolean     DEFAULT true,
  recipient_type   text        DEFAULT 'all',  -- 'all' | 'custom' | 'selected'
  recipient_emails text[],                     -- null when recipient_type = 'all'
  created_at       timestamptz DEFAULT now()
);
