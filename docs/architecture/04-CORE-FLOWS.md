# 核心功能流程

## 1. Issue 生命周期

### 1.1 创建 Issue

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│    Client    │      │  Go Backend  │      │   Database   │
└──────┬───────┘      └──────┬───────┘      └──────┬───────┘
       │                     │                     │
       │  POST /api/v1/workspaces/:wsId/issues      │
       │  { title, body, projectId?, priority? }   │
       │ ──────────────────────────────────────────>
       │                     │                     │
       │                     │  INSERT issue       │
       │                     │ ───────────────────>
       │                     │                     │
       │                     │  <198 rows inserted> │
       │                     │ <───────────────────│
       │                     │                     │
       │                     │  Publish event       │
       │                     │  "issue.created"    │
       │                     │                     │
       │  201 Created        │                     │
       │  { issue }          │                     │
       │ <─────────────────────────────────────────
       │                     │                     │
```

**前端代码路径:**
```typescript
// packages/core/issues/mutations.ts
useMutation({
  mutationFn: (data) => api.post(`/workspaces/${wsId}/issues`, data),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: issuesKeys.list(wsId) })
})
```

### 1.2 更新 Issue

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│    Client    │      │  Go Backend  │      │   Database   │
└──────┬───────┘      └──────┬───────┘      └──────┬───────┘
       │                     │                     │
       │  PATCH /api/v1/issues/:id                │
       │  { status?, priority?, assigneeId? ... }  │
       │ ──────────────────────────────────────────>
       │                     │                     │
       │                     │  UPDATE issue       │
       │                     │ ───────────────────>
       │                     │                     │
       │                     │  Publish event       │
       │                     │  "issue.updated"    │
       │                     │                     │
       │  200 OK             │                     │
       │  { issue }          │                     │
       │ <─────────────────────────────────────────│
       │                     │                     │
       │                     │  WS Broadcast        │
       │                     │ ────────────────────> [All Clients]
       │                     │                     │
```

**乐观更新模式:**
```typescript
// packages/core/issues/mutations.ts
useMutation({
  mutationFn: ({ id, ...data }) => api.patch(`/issues/${id}`, data),

  onMutate: async (variables) => {
    // 1. 取消所有相关的 in-flight 请求
    await queryClient.cancelQueries({ queryKey: issuesKeys.detail(wsId, variables.id) })

    // 2. 保存旧值用于回滚
    const previous = queryClient.getQueryData(issuesKeys.detail(wsId, variables.id))

    // 3. 乐观更新
    queryClient.setQueryData(issuesKeys.detail(wsId, variables.id), (old) => ({
      ...old,
      ...variables
    }))

    return { previous }
  },

  onError: (err, variables, context) => {
    // 回滚到旧值
    queryClient.setQueryData(
      issuesKeys.detail(wsId, variables.id),
      context.previous
    )
  },

  onSettled: () => {
    // 确保最新数据
    queryClient.invalidateQueries({ queryKey: issuesKeys.detail(wsId, id) })
  }
})
```

### 1.3 Issue 状态流转

```
用户操作                    API                    副作用
─────────────────────────────────────────────────────────────
指派给 Agent     ──────>  assignee_type='agent'  ──>  创建 TaskSession
开始工作        ──────>  status='in_progress'   ──>  WS 通知 Agent
提交审查        ──────>  status='in_review'     ──>  WS 通知相关人
完成            ──────>  status='done'          ──>  清除 Agent 占用
取消            ──────>  status='canceled'      ──>  释放 Agent
```

## 2. Agent 执行任务流程

### 2.1 整体架构

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Web UI    │      │  Go Backend │      │   Daemon    │
└──────┬──────┘      └──────┬──────┘      └──────┬──────┘
       │                    │                    │
       │ 1. Create Issue    │                    │
       │───────────────────>                    │
       │                    │                    │
       │ 2. Assign to Agent │ 3. Enqueue Task    │
       │                    │───────────────────>│
       │                    │                    │
       │ 4. WS: task.created│                    │
       │<───────────────────│                    │
       │                    │                    │
       │                    │ 5. Poll / long-poll│
       │                    │<───────────────────│
       │                    │                    │
       │                    │ 6. Task Payload    │
       │                    │<───────────────────│
       │                    │                    │
       │                    │ 7. WS: task.started│
       │<───────────────────│                    │
       │                    │                    │
       │                    │ 8. Execute         │
       │                    │  (Claude Code CLI) │
       │                    │                    │
       │                    │ 9. stdout/WS events │
       │                    │<───────────────────│
       │                    │                    │
       │ 10. WS: transcript│ 11. Task result    │
       │<───────────────────│<───────────────────│
       │                    │                    │
       │ 12. WS: task.done  │                    │
       │<───────────────────│                    │
```

### 2.2 Daemon 通信协议

```typescript
// Task payload (Backend → Daemon)
interface TaskPayload {
  taskId: string
  issueId: string
  agentId: string

  // 执行上下文
  instructions: string        // Agent system prompt + Skills
  issueTitle: string
  issueBody: string

  // Workspace 上下文
  workspaceId: string
  repo: {
    url: string
    branch: string
    commit?: string
  } | null

  // 工具权限
  allowedTools: ('read' | 'write' | 'exec')[]
}

// Daemon → Backend 事件
interface DaemonEvent {
  type: 'task.started' | 'task.output' | 'task.error' | 'task.done'
  taskId: string
  payload: any
}
```

### 2.3 WebSocket 实时事件

```typescript
// Backend → Clients 事件
interface RealtimeEvent {
  type: 'issue.updated' | 'task.created' | 'task.updated' |
        'chat.message' | 'runtime.status'
  workspaceId: string
  payload: any
  timestamp: string
}
```

## 3. Realtime 同步机制

### 3.1 WebSocket 连接建立

```
Client                              Backend
  │                                    │
  │  GET /ws?workspace_id=xxx&token=yyy │
  │ ───────────────────────────────────>
  │                                    │
  │  <101 Switching Protocols>          │
  │ <──────────────────────────────────│
  │                                    │
  │  ┌─────────────────────────────┐   │
  │  │ WebSocket 连接建立成功        │   │
  │  │ 加入 workspace room          │   │
  │  └─────────────────────────────┘   │
  │                                    │
```

### 3.2 Room 管理

```go
// server/internal/realtime/room.go
type Room struct {
  workspaceId string
  clients    map[*Client]struct{}
}

type Hub struct {
  rooms      map[string]*Room  // workspaceId → Room
  register   chan *Client
  unregister chan *Client
  broadcast  chan *Message
}

// 每个 workspace 一个 room
// 连接时自动加入对应 room
// 事件只在 room 内广播
```

### 3.3 事件流

```
┌─────────────────────────────────────────────────────────────┐
│                    Event Flow                               │
└─────────────────────────────────────────────────────────────┘

DB Write ──> Service ──> Publish Event ──> Hub ──> Room ──> Clients
                           │
                           ▼
                      ┌─────────┐
                      │ Broadcast│
                      └─────────┘

┌─────────────────────────────────────────────────────────────┐
│                  Event Types                                 │
├─────────────────────────────────────────────────────────────┤
│ issue.created     │ 新建 Issue                               │
│ issue.updated     │ Issue 字段更新                           │
│ issue.deleted     │ 删除 Issue                               │
│ ───────────────────┼───────────────────────────────────────│
│ task.created      │ Agent 开始处理任务                        │
│ task.started      │ Agent 实际开始执行                        │
│ task.output       │ Agent 输出（用于 transcript）             │
│ task.error        │ Agent 执行出错                           │
│ task.done         │ Agent 完成任务                           │
│ ───────────────────┼───────────────────────────────────────│
│ chat.message      │ 新对话消息                               │
│ ───────────────────┼───────────────────────────────────────│
│ runtime.status    │ Runtime 上线/下线                        │
│ agent.status      │ Agent 状态变化                           │
└─────────────────────────────────────────────────────────────┘
```

### 3.4 断线重连策略

```typescript
// packages/core/api/ws-client.ts

class WSClient {
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000

  connect() {
    this.ws = new WebSocket(this.url)

    this.ws.onclose = () => {
      // 指数退避重连
      setTimeout(() => {
        this.reconnectDelay = Math.min(
          this.reconnectDelay * 2,
          this.maxReconnectDelay
        )
        this.connect()
      }, this.reconnectDelay)
    }

    this.ws.onopen = () => {
      // 重置延迟
      this.reconnectDelay = 1000
    }
  }
}
```

### 3.5 Query Invalidation

```typescript
// packages/core/realtime/hooks.ts

useRealtimeSync(wsClient, {
  'issue.created': () => {
    queryClient.invalidateQueries({ queryKey: issuesKeys.all })
  },
  'issue.updated': ({ payload }) => {
    // 精准更新单个 Issue cache
    queryClient.setQueryData(
      issuesKeys.detail(payload.workspaceId, payload.id),
      (old) => ({ ...old, ...payload })
    )
  },
  'task.done': ({ payload }) => {
    // 更新关联的 Issue
    queryClient.invalidateQueries({
      queryKey: issuesKeys.detail(payload.workspaceId, payload.issueId)
    })
  }
})
```

## 4. 多工作区与权限

### 4.1 Workspace 切换

```
┌─────────────────────────────────────────────────────────────┐
│                 Workspace Switching Flow                      │
└─────────────────────────────────────────────────────────────┘

用户点击切换工作区
       │
       ▼
┌──────────────────┐
│ 1. 清除当前 Query Cache (保留 user preferences)
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ 2. 更新 URL (/from/acme → /from/linear)                        │
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ 3. WS 断开当前 room，加入新 room                               │
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ 4. 重新 fetch 新工作区数据 (因为 query key 变了)                │
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ 5. UI 渲染新工作区数据                                         │
└──────────────────┘

注意: Query key 包含 wsId，所以切换工作区自动触发 refetch
```

### 4.2 权限检查

```go
// server/internal/middleware/auth.go

func RequireRole(roles ...Role) Middleware {
  return func(next Handler) Handler {
    return HandlerFunc(func(w ResponseWriter, r *Request) {
      member := GetMember(r.Context())
      if !contains(member.Role, roles) {
        http.Error(w, "Forbidden", 403)
        return
      }
      next.ServeHTTP(w, r)
    })
  }
}

// 使用示例
router.Handle("/workspaces/{id}", RequireRole(owner, admin))
```

## 5. 状态管理模式

### 5.1 Server State (TanStack Query)

```typescript
// 特点:
// - 唯一数据源
// - 自动同步
// - 缓存 + 后台刷新
// - 乐观更新

// Workspace-scoped 查询
const { data: issues } = useIssues(wsId)
// wsId 变化 → 自动 refetch
// 底层: GET /api/v1/workspaces/:wsId/issues
```

### 5.2 Client State (Zustand)

```typescript
// 特点:
// - 仅存 UI 状态
// - 不需要持久化
// - 组件本地状态优先

// stores
├── selectionStore    // 当前选中
├── viewStore        // 视图偏好
├── draftStore       // 表单草稿
├── modalStore       // 弹窗
└── navigationStore  // 导航历史
```

### 5.3 状态流

```
┌─────────────────────────────────────────────────────────────┐
│                     State Flow                              │
└─────────────────────────────────────────────────────────────┘

                    ┌─────────────────┐
                    │   TanStack      │
                    │   Query Cache   │◄──── WS Events
                    │ (Server State)   │      (invalidate)
                    └────────┬────────┘
                             │
                             │ 读取
                             ▼
                    ┌─────────────────┐
                    │    React        │────► Zustand Stores
                    │    Components   │     (Client State)
                    └─────────────────┘
                             │
                             │ 写入
                             ▼
                    ┌─────────────────┐
                    │   Mutations     │────► API Call
                    │                 │      (optimistic update)
                    └─────────────────┘
```

### 5.4 硬规则检查

```typescript
// .eslintrc.js (架构规则检查)
{
  rules: {
    // 禁止 core 包依赖 react
    'no-restricted-imports': [
      'error',
      {
        patterns: ['@multica/core/*'],
        group: ['react', 'react-dom'],
      }
    ]
  }
}
```

## 6. 完整用户流程示例

### 6.1 分配任务给 Agent

```
Step 1: 用户在 Web UI 点击"Assign" → 选择 Agent
        │
        ▼
Step 2: PATCH /api/v1/issues/:id
        { assigneeType: 'agent', assigneeId: 'agent_xxx' }
        │
        ▼
Step 3: Backend 创建 TaskSession (pending)
        │
        ▼
Step 4: Backend WS 广播 "issue.updated"
        │
        ▼
Step 5: Daemon 收到任务 (通过 polling 或 WS)
        │
        ▼
Step 6: Daemon 启动 Claude Code 执行任务
        │
        ▼
Step 7: Daemon WS 发送 "task.output" (实时输出)
        │
        ▼
Step 8: 任务完成，Daemon WS 发送 "task.done"
        │
        ▼
Step 9: Backend WS 广播 "issue.updated" (status=done)
        │
        ▼
Step 10: Web UI 自动刷新，显示任务完成
```

### 6.2 Chat 流程

```
Step 1: 用户在 Issue 详情页打开 Chat Panel
        │
        ▼
Step 2: GET /api/v1/workspaces/:wsId/chat?issueId=:issueId
        │
        ▼
Step 3: WebSocket 订阅 chat.message 事件
        │
        ▼
Step 4: 用户发送消息
        │
        ▼
Step 5: POST /api/v1/chat/messages
        │
        ▼
Step 6: Backend 转发给 Agent (Daemon)
        │
        ▼
Step 7: Agent 生成响应
        │
        ▼
Step 8: Backend WS 广播 "chat.message"
        │
        ▼
Step 9: UI 即时显示新消息
```
