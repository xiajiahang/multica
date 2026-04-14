-- name: CreateChannel :one
INSERT INTO channels (workspace_id, name, type, topic, created_by)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetChannel :one
SELECT * FROM channels WHERE id = $1;

-- name: GetChannelInWorkspace :one
SELECT * FROM channels WHERE id = $1 AND workspace_id = $2;

-- name: ListChannelsByWorkspace :many
SELECT * FROM channels
WHERE workspace_id = $1
ORDER BY last_message_at DESC NULLS LAST;

-- name: UpdateChannel :one
UPDATE channels
SET name = COALESCE($2, name),
    topic = COALESCE($3, topic),
    updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: DeleteChannel :exec
DELETE FROM channels WHERE id = $1;

-- name: TouchChannel :exec
UPDATE channels SET last_message_at = NOW() WHERE id = $1;

-- name: CreateChannelMember :one
INSERT INTO channel_members (channel_id, member_type, member_id, role)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListChannelMembers :many
SELECT * FROM channel_members WHERE channel_id = $1;

-- name: GetChannelMember :one
SELECT * FROM channel_members WHERE channel_id = $1 AND member_type = $2 AND member_id = $3;

-- name: RemoveChannelMember :exec
DELETE FROM channel_members WHERE channel_id = $1 AND member_type = $2 AND member_id = $3;

-- name: UpdateChannelMemberLastRead :exec
UPDATE channel_members
SET last_read_at = $4
WHERE channel_id = $1 AND member_type = $2 AND member_id = $3;

-- name: CreateChannelMessage :one
INSERT INTO messages (channel_id, author_type, author_id, content)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListChannelMessages :many
SELECT * FROM messages
WHERE channel_id = $1
ORDER BY created_at DESC
LIMIT $2;

-- name: ListChannelMessagesBefore :many
SELECT * FROM messages
WHERE channel_id = $1 AND created_at < $2
ORDER BY created_at DESC
LIMIT $3;

-- name: CreateChannelTask :one
INSERT INTO agent_task_queue (agent_id, runtime_id, priority, channel_id, trigger_message_id, status)
VALUES ($1, $2, $3, $4, $5, 'queued')
RETURNING *;

-- name: GetLastChannelSession :one
SELECT * FROM agent_task_queue
WHERE agent_id = $1 AND channel_id = $2 AND status = 'completed'
ORDER BY completed_at DESC
LIMIT 1;

-- name: ListDMChannels :many
SELECT * FROM channels WHERE workspace_id = $1 AND type = 'dm';

-- name: CreateChannelIssue :one
INSERT INTO channel_issues (channel_id, issue_id, linked_by)
VALUES ($1, $2, $3)
RETURNING *;

-- name: ListChannelIssues :many
SELECT ci.* FROM channel_issues ci WHERE ci.channel_id = $1;
