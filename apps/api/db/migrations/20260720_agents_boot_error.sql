-- Migration: add last_boot_error jsonb column to agents table
-- task_id: 2f66a0f8-a15e-4a42-9b9c-2841fc99ba66
-- Idempotent: uses ADD COLUMN IF NOT EXISTS

ALTER TABLE zenithjoy.agents
  ADD COLUMN IF NOT EXISTS last_boot_error jsonb;
