-- server/migrations/040_channels.down.sql

ALTER TABLE agent_task_queue DROP COLUMN IF EXISTS channel_id;
ALTER TABLE agent_task_queue DROP COLUMN IF EXISTS trigger_message_id;

DROP TABLE IF EXISTS channel_issues;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS channel_members;
DROP TABLE IF EXISTS channels;
