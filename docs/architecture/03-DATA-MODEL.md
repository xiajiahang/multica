# 核心数据模型

## 1. 实体关系图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Workspace                                      │
│  id, name, slug, plan, created_at, updated_at                              │
└─────────────────────────────────────────────────────────────────────────────┘
        │
        ├──────────────────────────────────────────────┐
        │                                              │
        ▼                                              ▼
┌─────────────────────┐                    ┌─────────────────────┐
│       Member        │                    │      Project        │
│ user_id, role       │                    │ id, name, identifier│
│ (owner/admin/member)│                    └─────────────────────┘
└─────────────────────┘                              │
        │                                              │
        │  N:1                                         │ 1:N
        ▼                                              ▼
┌─────────────────────┐                    ┌─────────────────────┐
│        User         │                    │       Issue         │
│ id, email, name     │                    │ id, title, body     │
│ avatar_url          │                    │ status, priority   │
└─────────────────────┘                    │ assignee_type       │
                                           │ (user/agent)        │
┌─────────────────────┐                    │ assignee_id         │
│       Agent         │                    │ creator_id          │
│ id, name, provider  │                    │ project_id          │
│ instructions        │                    │ created_at          │
│ runtime_id          │                    └─────────────────────┘
│ skills[]                                    │
│ created_at                                    │
└─────────────────────┘                    ┌─────────────────────┐
        │                                    │    ChatMessage      │
        │ 1:N                                │ id, body, role     │
        ▼                                    │ (user/agent/system)│
┌─────────────────────┐                    │ session_id          │
│   TaskSession       │                    │ issue_id (optional) │
│ id, status          │                    └─────────────────────┘
│ (pending/running/   │                              │
│  completed/failed)  │                              │ N:1
│ issue_id            │                              ▼
│ runtime_id          │                    ┌─────────────────────┐
│ result, error       │                    │    ChatSession      │
│ created_at          │                    │ id, agent_id        │
└─────────────────────┘                    │ workspace_id        │
                                           └─────────────────────┘
        │
        │ N:1
        ▼
┌─────────────────────┐
│      Runtime        │
│ id, name, type      │
│ (local/cloud)       │
│ status, last_seen   │
│ machine_id          │
└─────────────────────┘

┌─────────────────────┐                    ┌─────────────────────┐
│      Skill          │                    │    InboxItem        │
│ id, name            │                    │ id, type            │
│ instructions        │                    │ title, body         │
│ agent_id            │                    │ read, actor_id      │
│ workspace_id        │                    │ created_at          │
└─────────────────────┘                    └─────────────────────┘
```

## 2. 核心实体详解

### 2.1 Workspace

```typescript
interface Workspace {
  id: string
  name: string
  slug: string           // URL 友好标识
  plan: 'free' | 'pro' | 'enterprise'
  createdAt: Date
  updatedAt: Date
}
```

**设计要点:**
- Workspace 是最高级别的隔离单元
- 所有资源都属于某个 Workspace
- slug 用于 URLs: app.multica.ai/{workspace-slug}

### 2.2 Member & Role

```typescript
type Role = 'owner' | 'admin' | 'member'

interface Member {
  workspaceId: string
  userId: string
  role: Role
  joinedAt: Date
}
```

**权限矩阵:**

| 操作 | Owner | Admin | Member |
|------|-------|-------|--------|
| 删除 Workspace | ✓ | | |
| 管理成员 | ✓ | ✓ | |
| 管理 Billing | ✓ | | |
| 创建 Agent | ✓ | ✓ | ✓ |
| 创建 Issue | ✓ | ✓ | ✓ |
| 评论 Issue | ✓ | ✓ | ✓ |

### 2.3 Issue (核心实体)

```typescript
type IssueStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'canceled'
type IssuePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none'
type AssigneeType = 'user' | 'agent'

interface Issue {
  id: string
  workspaceId: string
  projectId: string | null

  title: string
  body: string              // Markdown

  status: IssueStatus
  priority: IssuePriority

  // 分配给谁（人还是 Agent）
  assigneeType: AssigneeType | null
  assigneeId: string | null

  creatorId: string

  // 时间戳
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}
```

**状态机:**

```
   ┌──────┐
   │ todo │ ←─── (新建默认)
   └──────┘
       │
       ▼
   ┌───────────┐
   │ in_progress │
   └───────────┘
       │
       ▼
   ┌──────────┐     ┌──────────┐
   │ in_review │ ──→ │   done   │
   └──────────┘     └──────────┘
       │                 ▲
       │                 │
       └───── canceled ──┘
```

**优先级:**

```typescript
const PRIORITY_CONFIG = {
  urgent: { label: 'Urgent', color: 'red', order: 0 },
  high: { label: 'High', color: 'orange', order: 1 },
  medium: { label: 'Medium', color: 'yellow', order: 2 },
  low: { label: 'Low', color: 'green', order: 3 },
  none: { label: 'No Priority', color: 'gray', order: 4 },
}
```

### 2.4 Agent

```typescript
type AgentProvider = 'claude_code' | 'codex' | 'openclaw' | 'opencode'

interface Agent {
  id: string
  workspaceId: string
  runtimeId: string          // 关联的 Runtime

  name: string               // 展示名称
  provider: AgentProvider
  instructions: string       // System prompt

  status: 'idle' | 'busy' | 'offline'

  createdAt: Date
  updatedAt: Date
}
```

**设计要点:**
- Agent 是配置实体，定义在某个 Runtime 上运行
- Agent 可以有多个 Skill
- status 由关联的 Runtime 心跳更新

### 2.5 Runtime

```typescript
type RuntimeType = 'local' | 'cloud'

interface Runtime {
  id: string
  workspaceId: string

  name: string               // 用户自定义名称
  type: RuntimeType

  // 本地 Daemon
  machineId: string | null   // 机器唯一标识
  wsEndpoint: string | null  // Daemon WebSocket 地址

  // 云端
  endpoint: string | null

  status: 'online' | 'offline' | 'error'

  lastSeenAt: Date

  // 可用的 Agent CLI
  availableAgents: AgentProvider[]

  createdAt: Date
}
```

**Runtime vs Agent 区别:**

| 概念 | 说明 |
|------|------|
| Runtime | 计算环境（你的笔记本/云服务器） |
| Agent | 运行在 Runtime 上的 AI 角色配置 |

```
┌─────────────────────────────────────────────────┐
│              Runtime (我的 MacBook)             │
│                                                 │
│  ┌─────────────┐  ┌─────────────┐              │
│  │ Claude Code │  │   Codex     │  ← Agent     │
│  └─────────────┘  └─────────────┘              │
│                                                 │
│              Daemon Process                     │
└─────────────────────────────────────────────────┘
```

### 2.6 TaskSession

```typescript
type TaskSessionStatus = 'pending' | 'running' | 'completed' | 'failed'

interface TaskSession {
  id: string
  workspaceId: string

  issueId: string            // 关联的 Issue
  agentId: string
  runtimeId: string

  status: TaskSessionStatus

  // 执行结果
  result: string | null       // 完成时的输出
  error: string | null        // 失败原因

  // 消耗统计
  tokenUsage: {
    input: number
    output: number
  } | null

  createdAt: Date
  startedAt: Date | null
  completedAt: Date | null
}
```

**生命周期:**

```
Issue 分配给 Agent
        │
        ▼
  TaskSession created (status: pending)
        │
        │ Daemon 认领
        ▼
  TaskSession started (status: running)
        │
        ├─► 执行成功 ──► status: completed, result: 输出
        │
        └─► 执行失败 ──► status: failed, error: 原因
```

### 2.7 ChatMessage

```typescript
type MessageRole = 'user' | 'agent' | 'system'

interface ChatMessage {
  id: string
  workspaceId: string
  sessionId: string

  role: MessageRole
  body: string               // 内容

  // 用于流式输出的中间状态
  isComplete: boolean

  createdAt: Date
}
```

### 2.8 Skill

```typescript
interface Skill {
  id: string
  workspaceId: string

  name: string
  description: string

  // 指令内容（会追加到 Agent system prompt）
  instructions: string

  // 关联的 Agent
  agentIds: string[]

  createdAt: Date
  updatedAt: Date
}
```

**设计要点:**
- Skill 是可复用的指令片段
- 一个 Skill 可以关联多个 Agent
- 当 Agent 执行任务时，相关 Skill 的 instructions 会追加到 system prompt

### 2.9 InboxItem

```typescript
type InboxItemType =
  | 'issue_assigned'      // 任务分配给你
  | 'issue_mentioned'     // 被 @ 提及
  | 'issue_commented'     // 评论
  | 'agent_status'        // Agent 状态变化
  | 'system'

interface InboxItem {
  id: string
  workspaceId: string
  userId: string           // 接收者

  type: InboxItemType
  title: string
  body: string | null

  // 关联的资源
  actorId: string | null   // 触发者
  issueId: string | null
  agentId: string | null

  read: boolean

  createdAt: Date
}
```

## 3. 多态关联 (Polymorphic Relations)

### 3.1 Assignee 多态

Issue 的 assignee 是多态的，可以指向 User 或 Agent：

```typescript
// 存储方式
interface Issue {
  assigneeType: 'user' | 'agent' | null
  assigneeId: string | null
}

// 查询时需要 UNION
// 详见: server/internal/storage/queries/issues.sql
```

### 3.1 Actor 多态

InboxItem 的 actor 可以是 User 或 Agent：

```typescript
interface InboxItem {
  actorType: 'user' | 'agent' | 'system' | null
  actorId: string | null
}
```

## 4. 索引策略

核心查询索引:

```sql
-- Workspace 隔离
CREATE INDEX idx_issues_workspace ON issues(workspace_id);
CREATE INDEX idx_agents_workspace ON agents(workspace_id);
CREATE INDEX idx_runtimes_workspace ON runtimes(workspace_id);

-- 常见查询
CREATE INDEX idx_issues_status ON issues(workspace_id, status);
CREATE INDEX idx_issues_assignee ON issues(workspace_id, assignee_type, assignee_id);
CREATE INDEX idx_issues_project ON issues(workspace_id, project_id);

-- 时间排序
CREATE INDEX idx_issues_created ON issues(workspace_id, created_at DESC);
CREATE INDEX idx_inbox_user ON inbox_items(user_id, read, created_at DESC);
```

## 5. 向量存储 (pgvector)

用于语义搜索和 AI 相关功能:

```sql
-- Skill 语义匹配
CREATE TABLE skill_embeddings (
  skill_id TEXT REFERENCES skills(id),
  embedding vector(1536),
  PRIMARY KEY (skill_id)
);

-- 未来扩展: Issue 语义搜索
CREATE TABLE issue_embeddings (
  issue_id TEXT REFERENCES issues(id),
  embedding vector(1536),
  PRIMARY KEY (issue_id)
);
```
