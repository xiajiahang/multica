# API 架构

## 1. API 风格

- **RESTful** — 资源导向 URL
- **JSON** — 请求和响应格式
- **认证** — Bearer Token (JWT)
- **版本** — `/api/v1/` 前缀

## 2. 认证

### 2.1 获取 Token

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "xxx"
}
```

响应:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "usr_xxx",
    "email": "user@example.com",
    "name": "John Doe",
    "avatarUrl": "https://..."
  }
}
```

### 2.2 使用 Token

```http
GET /api/v1/workspaces
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

## 3. 错误响应

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Title is required",
    "details": [
      { "field": "title", "message": "cannot be empty" }
    ]
  }
}
```

**错误码:**

| HTTP Status | Code | 说明 |
|-------------|------|------|
| 400 | VALIDATION_ERROR | 请求参数错误 |
| 401 | UNAUTHORIZED | 未认证 |
| 403 | FORBIDDEN | 无权限 |
| 404 | NOT_FOUND | 资源不存在 |
| 409 | CONFLICT | 资源冲突 |
| 500 | INTERNAL_ERROR | 服务器错误 |

## 4. 资源 API

### 4.1 Workspaces

```http
# 列出我的工作区
GET /api/v1/workspaces

# 创建工作区
POST /api/v1/workspaces
{
  "name": "My Team"
}

# 获取工作区详情
GET /api/v1/workspaces/:workspaceId

# 更新工作区
PATCH /api/v1/workspaces/:workspaceId
{
  "name": "New Name"
}

# 删除工作区
DELETE /api/v1/workspaces/:workspaceId
```

### 4.2 Issues

```http
# 列出 Issues
GET /api/v1/workspaces/:workspaceId/issues

Query Parameters:
- status: IssueStatus (可选, 过滤状态)
- assigneeId: string (可选)
- projectId: string (可选)
- limit: number (默认 50)
- cursor: string (分页游标)

# 创建 Issue
POST /api/v1/workspaces/:workspaceId/issues
{
  "title": "Fix login bug",
  "body": "## Description\n...",
  "priority": "high",
  "projectId": "proj_xxx"
}

# 获取 Issue 详情
GET /api/v1/issues/:issueId

# 更新 Issue
PATCH /api/v1/issues/:issueId
{
  "status": "in_progress",
  "priority": "urgent",
  "assigneeType": "agent",
  "assigneeId": "agent_xxx"
}

# 删除 Issue
DELETE /api/v1/issues/:issueId
```

### 4.3 Agents

```http
# 列出 Agents
GET /api/v1/workspaces/:workspaceId/agents

# 创建 Agent
POST /api/v1/workspaces/:workspaceId/agents
{
  "name": "Code Reviewer",
  "runtimeId": "rt_xxx",
  "provider": "claude_code",
  "instructions": "You are a code reviewer..."
}

# 获取 Agent 详情
GET /api/v1/agents/:agentId

# 更新 Agent
PATCH /api/v1/agents/:agentId
{
  "instructions": "Updated instructions..."
}

# 删除 Agent
DELETE /api/v1/agents/:agentId

# 获取 Agent 任务历史
GET /api/v1/agents/:agentId/tasks
```

### 4.4 Runtimes

```http
# 列出 Runtimes
GET /api/v1/workspaces/:workspaceId/runtimes

# 注册 Runtime (Daemon 调用)
POST /api/v1/workspaces/:workspaceId/runtimes
{
  "name": "My MacBook",
  "type": "local",
  "machineId": "unique-machine-id",
  "wsEndpoint": "ws://localhost:7890",
  "availableAgents": ["claude_code", "codex"]
}

# 更新 Runtime 状态
PATCH /api/v1/runtimes/:runtimeId
{
  "status": "online"
}

# 移除 Runtime
DELETE /api/v1/runtimes/:runtimeId
```

### 4.5 Chat

```http
# 列出 Chat Sessions
GET /api/v1/workspaces/:workspaceId/chat

Query Parameters:
- issueId: string (可选, 获取某个 Issue 的会话)

# 创建/获取 Session
POST /api/v1/workspaces/:workspaceId/chat
{
  "agentId": "agent_xxx",
  "issueId": "issue_xxx"
}

# 发送消息
POST /api/v1/chat/sessions/:sessionId/messages
{
  "body": "Hello, can you review this PR?"
}

# 获取消息历史
GET /api/v1/chat/sessions/:sessionId/messages
```

### 4.6 Inbox

```http
# 列出 Inbox Items
GET /api/v1/workspaces/:workspaceId/inbox

Query Parameters:
- read: boolean (可选)
- limit: number

# 标记已读
PATCH /api/v1/inbox/:inboxItemId
{
  "read": true
}

# 标记全部已读
POST /api/v1/workspaces/:workspaceId/inbox/mark-all-read
```

### 4.7 Projects

```http
# 列出 Projects
GET /api/v1/workspaces/:workspaceId/projects

# 创建 Project
POST /api/v1/workspaces/:workspaceId/projects
{
  "name": "Backend API",
  "identifier": "API"
}

# 获取 Project 详情
GET /api/v1/projects/:projectId

# 更新 Project
PATCH /api/v1/projects/:projectId
{
  "name": "New Name"
}
```

### 4.8 Members

```http
# 列出成员
GET /api/v1/workspaces/:workspaceId/members

# 邀请成员
POST /api/v1/workspaces/:workspaceId/members
{
  "email": "new@example.com",
  "role": "member"
}

# 更新成员角色
PATCH /api/v1/workspaces/:workspaceId/members/:memberId
{
  "role": "admin"
}

# 移除成员
DELETE /api/v1/workspaces/:workspaceId/members/:memberId
```

## 5. WebSocket API

### 5.1 连接

```http
GET /ws?workspace_id=:workspaceId&token=:token
Upgrade: websocket
```

### 5.2 客户端 → 服务端 消息

```json
{
  "type": "subscribe",
  "channels": ["issues", "tasks"]
}

{
  "type": "unsubscribe",
  "channels": ["chat"]
}
```

### 5.3 服务端 → 客户端 事件

```json
{
  "type": "event",
  "channel": "issues",
  "data": {
    "event": "issue.updated",
    "payload": { ... }
  }
}
```

## 6. sqlc 使用

所有数据库查询通过 sqlc 生成类型安全的 Go 代码：

```yaml
# server/sqlc.yaml
version: "2"
sql:
  - engine: "postgresql"
    queries: "internal/storage/queries/"
    gen:
      go:
        package: "db"
        out: "internal/storage/db"
```

```sql
-- server/internal/storage/queries/issues.sql

-- name: GetIssue :one
SELECT * FROM issues WHERE id = $1;

-- name: ListIssues :many
SELECT * FROM issues
WHERE workspace_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: CreateIssue :one
INSERT INTO issues (id, workspace_id, title, body, status, priority)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;
```

生成的代码：

```go
// internal/storage/db/issues.sql.go

type GetIssueParams struct {
  ID string
}

func (q *Queries) GetIssue(ctx context.Context, id string) (Issue, error) {
  // ...
}
```
