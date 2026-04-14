# Channels & DM — 设计规格

**日期:** 2026-04-14
**状态:** 草案
**范围:** 为 Multica 新增频道（Channel）实时协作层，与现有 Issue Board 并存

## 背景

Multica 将 AI agent 定位为团队成员，但目前唯一的交互模式是 Issue 驱动的：分配一个 issue，等待 agent 完成。Slock.ai 展示了另一种可能——基于频道的协作，agent 以平等的身份参与实时对话。

本规格为 Multica 新增 Channels + DM 层。目标：让开发者与 agent 实时对话，通过 @mention 获得即时帮助，同时保留 Issue Board 作为结构化任务追踪的骨架。

## 设计原则

1. **在现有架构上增量迭代** — 复用 daemon 任务队列、执行管线和 WS 事件总线，不重写。
2. **Issue Board 不变** — 频道和 Issue 并存。频道负责实时协作，Issue 负责追踪工作。
3. **第一版：仅 @触发** — agent 只在 @mention 时响应。自动响应模式作为后续迭代。
4. **第一版不做 Thread** — 消息平铺展示，线程回复后续再加。
5. **DM 是特殊频道** — 统一数据模型，`type=dm`。

## 核心流程

### 发送消息并触发 Agent

```
用户在频道中发送消息
  → INSERT INTO messages
  → 广播 channel:message_new
  → 解析消息中的 @agent 提及
     ├─ 没有 @agent → 结束
     └─ 检测到 @agent → EnqueueTask(agentId, channelId, messageId)
         → INSERT INTO agent_task_queue (status='queued')
         → 广播 task:dispatch

Daemon pollLoop（不变）
  → ClaimTask → 返回频道上下文
  → handleTask（不变）
  → runTask:
     ├─ 检测 channel_id → BuildChannelPrompt()
     │   （频道历史 + 当前消息 + agent skills）
     ├─ agent.Backend.Execute()（不变）
     ├─ 通过 ReportTaskMessages 流式输出（不变）
     └─ CompleteTask:
        → INSERT INTO messages (author_type='agent')
        → 广播 channel:message_new
```

### Agent 上下文恢复

当 agent 在频道中被第二次触发时：
- 复用现有的 `PriorSessionID` + `PriorWorkDir` 机制
- 查找同一 (agent, channel) 对的上一次已完成任务
- Agent 带着上次对话的完整上下文恢复

## 数据模型

### 新增表

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

### 现有表变更

```sql
ALTER TABLE agent_task_queue
    ADD COLUMN channel_id UUID REFERENCES channels(id),
    ADD COLUMN trigger_message_id UUID REFERENCES messages(id);
```

## Server API

### 频道 CRUD

| 方法 | 路径 | 处理器 |
|------|------|--------|
| GET | `/api/workspaces/{wsId}/channels` | ListChannels |
| POST | `/api/workspaces/{wsId}/channels` | CreateChannel |
| GET | `/api/workspaces/{wsId}/channels/{channelId}` | GetChannel |
| PATCH | `/api/workspaces/{wsId}/channels/{channelId}` | UpdateChannel |
| DELETE | `/api/workspaces/{wsId}/channels/{channelId}` | DeleteChannel |

### 成员管理

| 方法 | 路径 | 处理器 |
|------|------|--------|
| GET | `/api/workspaces/{wsId}/channels/{channelId}/members` | ListMembers |
| POST | `/api/workspaces/{wsId}/channels/{channelId}/members` | AddMember |
| DELETE | `/api/workspaces/{wsId}/channels/{channelId}/members/{memberType}/{memberId}` | RemoveMember |

### 消息

| 方法 | 路径 | 处理器 |
|------|------|--------|
| GET | `/api/workspaces/{wsId}/channels/{channelId}/messages?cursor=&limit=50` | ListMessages |
| POST | `/api/workspaces/{wsId}/channels/{channelId}/messages` | SendMessage |

### DM 快捷方式

| 方法 | 路径 | 处理器 |
|------|------|--------|
| POST | `/api/workspaces/{wsId}/dms` | CreateOrGetDM（按成员对 upsert） |

### Issue 关联

| 方法 | 路径 | 处理器 |
|------|------|--------|
| POST | `/api/workspaces/{wsId}/channels/{channelId}/issues` | LinkIssue |
| GET | `/api/workspaces/{wsId}/channels/{channelId}/issues` | ListLinkedIssues |

### SendMessage 处理逻辑

```
1. 验证用户是频道成员
2. INSERT INTO messages
3. UPDATE channels SET last_message_at = NOW()
4. 广播 channel:message_new
5. 解析内容中的 @agent 提及
6. 对每个被 @的 agent：
   a. 验证 agent 是频道成员且处于活跃状态
   b. 调用 EnqueueTask(agentId, channelId, messageId)
   c. 广播 task:dispatch
```

## WebSocket 事件

### 新增事件类型

| 事件 | 载荷 | 说明 |
|------|------|------|
| `channel:created` | `{ channel }` | 工作区中创建了频道 |
| `channel:updated` | `{ channel }` | 频道名称/主题更新 |
| `channel:member_joined` | `{ channelId, memberType, memberId }` | 成员加入 |
| `channel:member_left` | `{ channelId, memberType, memberId }` | 成员离开 |
| `channel:message_new` | `{ channelId, message }` | 新消息 |
| `channel:message_edited` | `{ channelId, message }` | 消息编辑 |
| `channel:message_deleted` | `{ channelId, messageId }` | 消息删除 |
| `channel:read` | `{ channelId, memberId, lastReadAt }` | 已读标记更新 |

### 复用的现有事件

- `task:dispatch` — 频道消息触发的 agent 任务入队
- `task:message` — agent 流式输出（在频道 UI 中展示）
- `task:completed` — agent 完成频道任务
- `task:failed` — agent 频道任务失败

### 事件路由

所有频道事件按 workspace room 划分（与现有机制一致）。前端根据 `channelId` 过滤，决定更新哪个频道视图。

## Daemon 改动

### 改动点

**1. ClaimTask 响应 — 新增任务上下文类型**

当 `task.channel_id` 有值时，claim 响应包含：
- 频道名称、类型、主题
- 最近消息（最近 50 条）
- 触发消息内容
- 上下文恢复信息（同一 agent + channel 的上次完成任务）

**2. Prompt Builder — 频道变体**

```
BuildChannelPrompt(task, messages):
  "你是 {agentName}，频道 #{channelName} 的成员。
   频道主题: {topic}
   成员列表: {member list}

   最近对话:
   [时间戳] {作者}: {内容}
   ...

   {触发消息作者} @了你:
   {触发消息内容}

   请在频道中回复。你的回复将作为消息发送。"
```

**3. CompleteTask — 频道结果回写**

当 `task.channel_id` 有值时：
- Agent 输出 → INSERT INTO messages (author_type='agent', channel_id)
- 广播 channel:message_new

### 不变的部分

| 组件 | 原因 |
|------|------|
| pollLoop + round-robin | 任务队列统一 |
| handleTask 生命周期 | Start → run → complete/fail 不变 |
| execenv（workdir 隔离） | 同样的隔离模型 |
| agent.Backend.Execute | 同样的 CLI 调用方式 |
| 500ms 消息批量上报 | 同样的流式管线 |
| Heartbeat | 与任务类型无关 |
| Token 用量上报 | 同样的路径 |

## 前端

### 新增文件

```
packages/views/channels/
├── channel-list.tsx          # 侧边栏频道列表
├── channel-view.tsx          # 频道主视图（消息流 + 输入框）
├── channel-header.tsx        # 频道名称、主题、成员
├── message-list.tsx          # 消息流（向上无限滚动加载）
├── message-item.tsx          # 单条消息（用户/agent 区分样式）
├── message-input.tsx         # 富文本输入框（@提及自动补全）
└── components/
    ├── agent-status.tsx      # Agent 在线/休眠状态指示器
    └── issue-card-inline.tsx # 消息中内嵌的 Issue 卡片
```

### 侧边栏集成

```
Inbox
Issues
Channels                    ← 新增分组
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

### 消息渲染

- **用户消息**：头像 + 名称 + 内容，与现有评论样式一致
- **Agent 消息**：紫色标识 + 机器人图标（复用现有 agent 样式）+ 流式输出时显示打字动画
- **流式输出**：复用 chat 页面的流式渲染逻辑

### TanStack Query 集成

```
useChannelList(wsId)                    → query key: ['channels', wsId]
useChannel(wsId, channelId)             → query key: ['channels', wsId, channelId]
useChannelMessages(wsId, channelId)     → query key: ['channels', wsId, channelId, 'messages']
useChannelMembers(wsId, channelId)      → query key: ['channels', wsId, channelId, 'members']
```

WS 事件触发相关 query key 的 invalidation（与 Issue 同样的模式）。

### 导航

频道视图使用 NavigationAdapter — 不导入 `next/navigation` 或 `react-router-dom`。路由定义：
- Web: `apps/web/app/(dashboard)/channels/[channelId]/page.tsx`
- Desktop: 在 desktop router 中注册

## 范围边界

### v1 范围内

- 频道 CRUD（公开、私密、DM）
- 消息收发（富文本）
- @agent → 任务入队 → agent 在频道中回复
- Agent 流式输出在频道中展示
- 频道-Issue 关联（基础）
- 未读标记（last_read_at）
- 侧边栏频道列表 + 未读计数

### v1 范围外（后续迭代）

- 频道自动响应模式
- 线程回复
- 消息搜索
- 消息中的文件附件
- 消息表情回应
- 正在输入指示
- 频道通知 / Inbox 集成
- Agent 跨频道记忆持久化
- 智能 Agent 路由

## 迁移策略

1. **迁移 1**：创建新表（channels, channel_members, messages, channel_issues）
2. **迁移 2**：修改 agent_task_queue，新增 channel_id 和 trigger_message_id 字段
3. **Server**：新增处理器 + service 扩展（不改动现有端点）
4. **Daemon**：Prompt builder 扩展（向后兼容）
5. **前端**：新增 views/channels 包（纯新增）

每个步骤可独立部署。现有的 Issue/Chat 功能不受影响。
