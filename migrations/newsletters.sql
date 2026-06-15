-- Run this in the Supabase SQL Editor (https://supabase.com/dashboard)
-- Project: uvcdffktunyhrrsbcpdm

CREATE TABLE IF NOT EXISTS newsletters (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  subject      text        NOT NULL,
  preview_text text,
  body         text        NOT NULL,
  sent_at      timestamptz,
  created_at   timestamptz DEFAULT now()
);
