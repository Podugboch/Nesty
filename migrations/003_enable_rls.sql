-- Migration 003: Enable Row-Level Security (RLS) on all public tables
-- Safe to execute against existing databases
-- Prevents unauthorized direct PostgREST access via Supabase public endpoints

ALTER TABLE IF EXISTS public.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.conversation_mutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.message_reactions ENABLE ROW LEVEL SECURITY;
