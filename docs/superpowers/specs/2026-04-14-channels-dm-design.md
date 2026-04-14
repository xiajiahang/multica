# Channels & DM — Design Spec

**Date:** 2026-04-14
**Status:** Draft
**Scope:** Add channel-based real-time collaboration to Multica, alongside existing Issue Board

## Motivation

Multica positions AI agents as teammates, but today the only interaction model is issue-driven: assign an issue, wait for the agent to complete it. Slock.ai demonstrates an alternative — channel-based collaboration where agents participate as equals in real-time conversations.

This spec adds a Channels + DM layer to Multica. The goal: let developers chat with agents in real-time, @mention them for immediate help, and keep issue tracking as the structured backbone.

## Design Principles

1. **Incremental on existing architecture** — reuse the daemon task queue, execution pipeline, and WS event bus. No rewrite.
2. **Issue Board stays** — channels and issues coexist. Channels are for real-time collaboration; issues are for tracked work.
3. **First version: @-trigger only** — agents respond when @mentioned. Auto-respond mode is a future iteration.
4. **No threads in v1** — messages are flat. Thread replies can be added later.
5. **DM as a special channel** — one unified data model, `type=dm`.

## Core Flow

### Sending a message and triggering an agent

```
User sends message in channel
  → INSERT INTO messages
  → Broadcast channel:message_new
  → Parse message for @agent mentions
     ├─ No @agent → done
     └─ @agent found → EnqueueTask(agentId, channelId, messageId)
         → INSERT INTO agent_task_queue (status='queued')
         → Broadcast task:dispatch

Daemon pollLoop (unchanged)
  → ClaimTask → returns channel context
  → handleTask (unchanged)
  → runTask:
     ├─ Detect channel_id → BuildChannelPrompt()
     │   (channel history + current message + agent skills)
     ├─ agent.Backend.Execute() (unchanged)
     ├─ Stream output via ReportTaskMessages (unchanged)
     └─ CompleteTask:
        → INSERT INTO messages (author_type='agent')
        → Broadcast channel:message_new
```

### Agent context restoration

When an agent is triggered in a channel for the second time:
- Reuse the existing `PriorSessionID` + `PriorWorkDir` mechanism from the issue flow
- Look up the last completed task for the same (agent, channel) pair
- Agent resumes with full context from the previous conversation

## Data Model

### New tables

```sql
CREATE TABLE channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('public', 'private', 'dm')),
    topic TEXT DEFAULT '',
    created_by UUID REFERENCES members(id),
    last_message_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_channels_workspace ON channels(workspace_id);
CREATE INDEX idx_channels_last_message ON channels(workspace_id, last_message_at DESC NULLS LAST);

CREATE TABLE channel_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    member_type VARCHAR(20) NOT NULL CHECK (member_type IN ('user', 'agent')),
    member_id UUID NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    last_read_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(channel_id, member_type, member_id)
);

CREATE INDEX idx_channel_members_lookup ON channel_members(channel_id);
CREATE INDEX idx_channel_members_entity ON channel_members(member_type, member_id);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_type VARCHAR(20) NOT NULL CHECK (author_type IN ('user', 'agent')),
    author_id UUID NOT NULL,
    content JSONB,
    attachments JSONB,
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_channel_created ON messages(channel_id, created_at DESC);

CREATE TABLE channel_issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    linked_by UUID REFERENCES members(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(channel_id, issue_id)
);

CREATE INDEX idx_channel_issues_channel ON channel_issues(channel_id);
CREATE INDEX idx_channel_issues_issue ON channel_issues(issue_id);
```

### Existing table changes

```sql
ALTER TABLE agent_task_queue
    ADD COLUMN channel_id UUID REFERENCES channels(id),
    ADD COLUMN trigger_message_id UUID REFERENCES messages(id);
```

## Server API

### Channel CRUD

| Method | Path | Handler |
|--------|------|---------|
| GET | `/api/workspaces/{wsId}/channels` | ListChannels |
| POST | `/api/workspaces/{wsId}/channels` | CreateChannel |
| GET | `/api/workspaces/{wsId}/channels/{channelId}` | GetChannel |
| PATCH | `/api/workspaces/{wsId}/channels/{channelId}` | UpdateChannel |
| DELETE | `/api/workspaces/{wsId}/channels/{channelId}` | DeleteChannel |

### Members

| Method | Path | Handler |
|--------|------|---------|
| GET | `/api/workspaces/{wsId}/channels/{channelId}/members` | ListMembers |
| POST | `/api/workspaces/{wsId}/channels/{channelId}/members` | AddMember |
| DELETE | `/api/workspaces/{wsId}/channels/{channelId}/members/{memberType}/{memberId}` | RemoveMember |

### Messages

| Method | Path | Handler |
|--------|------|---------|
| GET | `/api/workspaces/{wsId}/channels/{channelId}/messages?cursor=&limit=50` | ListMessages |
| POST | `/api/workspaces/{wsId}/channels/{channelId}/messages` | SendMessage |

### DM shortcut

| Method | Path | Handler |
|--------|------|---------|
| POST | `/api/workspaces/{wsId}/dms` | CreateOrGetDM (upsert by member pair) |

### Issue linking

| Method | Path | Handler |
|--------|------|---------|
| POST | `/api/workspaces/{wsId}/channels/{channelId}/issues` | LinkIssue |
| GET | `/api/workspaces/{wsId}/channels/{channelId}/issues` | ListLinkedIssues |

### SendMessage handler logic

```
1. Validate user is a member of the channel
2. INSERT INTO messages
3. UPDATE channels SET last_message_at = NOW()
4. Broadcast channel:message_new
5. Parse content for @agent mentions
6. For each @mentioned agent:
   a. Verify agent is a channel member and is active
   b. Call EnqueueTask(agentId, channelId, messageId)
   c. Broadcast task:dispatch
```

## WebSocket Events

### New event types

| Event | Payload | Description |
|-------|---------|-------------|
| `channel:created` | `{ channel }` | Channel created in workspace |
| `channel:updated` | `{ channel }` | Channel name/topic updated |
| `channel:member_joined` | `{ channelId, memberType, memberId }` | Member added |
| `channel:member_left` | `{ channelId, memberType, memberId }` | Member removed |
| `channel:message_new` | `{ channelId, message }` | New message |
| `channel:message_edited` | `{ channelId, message }` | Message edited |
| `channel:message_deleted` | `{ channelId, messageId }` | Message deleted |
| `channel:read` | `{ channelId, memberId, lastReadAt }` | Read marker updated |

### Existing events reused

- `task:dispatch` — agent task queued from channel message
- `task:message` — agent streaming output (displayed in channel UI)
- `task:completed` — agent finished channel task
- `task:failed` — agent failed channel task

### Event routing

All channel events are scoped to the workspace room (same as existing). The frontend filters by `channelId` to determine which channel view should update.

## Daemon Changes

### What changes

**1. ClaimTask response — new task context type**

When `task.channel_id` is set, the claim response includes:
- Channel name, type, topic
- Recent messages (last 50)
- The trigger message
- Prior session info (last completed task for same agent + channel)

**2. Prompt Builder — channel variant**

```
BuildChannelPrompt(task, messages):
  "You are {agentName}, a member of channel #{channelName}.
   Channel topic: {topic}
   Members: {member list}

   Recent conversation:
   [timestamp] {author}: {content}
   ...

   {triggerMessage.author} @mentioned you:
   {triggerMessage.content}

   Respond in the channel. Your response will be posted as a message."
```

**3. CompleteTask — channel result path**

When `task.channel_id` is set:
- Agent output → INSERT INTO messages (author_type='agent', channel_id)
- Broadcast channel:message_new

### What stays the same

| Component | Reason |
|-----------|--------|
| pollLoop + round-robin | Task queue is unified |
| handleTask lifecycle | Start → run → complete/fail unchanged |
| execenv (workdir isolation) | Same isolation model |
| agent.Backend.Execute | Same CLI invocation |
| 500ms message batching | Same streaming pipeline |
| Heartbeat | Unrelated to task type |
| Token usage reporting | Same path |

## Frontend

### New files

```
packages/views/channels/
├── channel-list.tsx          # Sidebar channel list
├── channel-view.tsx          # Main channel view (messages + input)
├── channel-header.tsx        # Channel name, topic, members
├── message-list.tsx          # Message stream (infinite scroll up)
├── message-item.tsx          # Single message (user vs agent styling)
├── message-input.tsx         # Rich input with @mention autocomplete
└── components/
    ├── agent-status.tsx      # Agent online/hibernating indicator
    └── issue-card-inline.tsx # Inline issue card in messages
```

### Sidebar integration

```
Inbox
Issues
Channels                    ← New section
├── Channels
│   ├── # frontend-dev
│   └── # general
└── Direct Messages
    ├── Agent Claude
    └── Jiahang
Agents
Runtimes
Settings
```

### Message rendering

- **User messages**: avatar + name + content (consistent with existing comments)
- **Agent messages**: purple badge + robot icon (reuse existing agent styling) + streaming typing animation
- **Streaming output**: reuse chat page streaming render logic

### TanStack Query integration

```
useChannelList(wsId)                    → query key: ['channels', wsId]
useChannel(wsId, channelId)             → query key: ['channels', wsId, channelId]
useChannelMessages(wsId, channelId)     → query key: ['channels', wsId, channelId, 'messages']
useChannelMembers(wsId, channelId)      → query key: ['channels', wsId, channelId, 'members']
```

WS events invalidate the relevant query keys (same pattern as issues).

### Navigation

Channel views use the NavigationAdapter — no `next/navigation` or `react-router-dom` imports. Route definitions:
- Web: `apps/web/app/(dashboard)/channels/[channelId]/page.tsx`
- Desktop: registered in desktop router

## Scope Boundaries

### In scope (v1)

- Channel CRUD (public, private, dm)
- Message send/receive (rich text)
- @mention agent → task enqueue → agent response in channel
- Agent streaming output in channel
- Channel-Issue linking (basic)
- Unread indicators (last_read_at)
- Sidebar channel list with unread counts

### Out of scope (future iterations)

- Channel auto-respond mode
- Thread replies
- Message search
- File attachments in messages
- Message reactions
- Typing indicators
- Channel notifications / inbox integration
- Agent memory persistence across channels
- Smart agent routing

## Migration Strategy

1. **Migration 1**: Create new tables (channels, channel_members, messages, channel_issues)
2. **Migration 2**: Alter agent_task_queue to add channel_id and trigger_message_id
3. **Server**: New handlers + service extensions (no breaking changes to existing endpoints)
4. **Daemon**: Prompt builder extension (backward compatible)
5. **Frontend**: New views/channels package (additive)

Each step is independently deployable. Existing issue/chat functionality is untouched.
