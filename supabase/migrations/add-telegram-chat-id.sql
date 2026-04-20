-- Add telegram_chat_id to stores for per-store group notifications
alter table stores add column if not exists telegram_chat_id text;
