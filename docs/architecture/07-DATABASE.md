# 数据库架构

## 1. 概览

- **数据库**: PostgreSQL 17
- **向量扩展**: pgvector (用于 AI 相关功能)
- **ORM/查询**: sqlc (类型安全的 SQL)
- **迁移**: golang-migrate

## 2. Schema

### 2.1 workspaces

```sql
CREATE TABLE workspaces (
    id TEXT PRIMARY KEY DEFAULT gen_random_id('ws'),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workspaces_slug ON workspaces(slug);
```

### 2.2 users

```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY DEFAULT gen_random_id('usr'),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users(email);
```

### 2.3 members

```sql
CREATE TABLE members (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX idx_members_user ON members(user_id);
CREATE INDEX idx_members_workspace ON members(workspace_id);
```

### 2.4 projects

```sql
CREATE TABLE projects (
    id TEXT PRIMARY KEY DEFAULT gen_random_id('prj'),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    identifier TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, identifier)
);

CREATE INDEX idx_projects_workspace ON projects(workspace_id);
```

### 2.5 issues

```sql
CREATE TABLE issues (
    id TEXT PRIMARY KEY DEFAULT gen_random_id('iss'),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,

    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',

    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'none',

    -- 多态分配: assignee_type + assignee_id
    assignee_type TEXT,  -- 'user' or 'agent'
    assignee_id TEXT,

    creator_id TEXT NOT NULL REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_issues_workspace ON issues(workspace_id);
CREATE INDEX idx_issues_status ON issues(workspace_id, status);
CREATE INDEX idx_issues_assignee ON issues(workspace_id, assignee_type, assignee_id);
CREATE INDEX idx_issues_project ON issues(workspace_id, project_id);
CREATE INDEX idx_issues_created ON issues(workspace_id, created_at DESC);
```

### 2.6 runtimes

```sql
CREATE TABLE runtimes (
    id TEXT PRIMARY KEY DEFAULT gen_random_id('rt'),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'local',  -- 'local' or 'cloud'

    -- 本地 Daemon
    machine_id TEXT,
    ws_endpoint TEXT,

    -- 云端
    endpoint TEXT,

    status TEXT NOT NULL DEFAULT 'offline',  -- 'online', 'offline', 'error'

    last_seen_at TIMESTAMPTZ,

    -- 可用的 Agent CLI
    available_agents TEXT[] NOT NULL DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_runtimes_workspace ON runtimes(workspace_id);
CREATE INDEX idx_runtimes_machine ON runtimes(workspace_id, machine_id);
```

### 2.7 agents

```sql
CREATE TABLE agents (
    id TEXT PRIMARY KEY DEFAULT gen_random_id('agt'),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    runtime_id TEXT NOT NULL REFERENCES runtimes(id) ON DELETE CASCADE,

    name TEXT NOT NULL,
    provider TEXT NOT NULL,  -- 'claude_code', 'codex', 'openclaw', 'opencode'

    instructions TEXT NOT NULL DEFAULT '',

    status TEXT NOT NULL DEFAULT 'offline',  -- 'idle', 'busy', 'offline'

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agents_workspace ON agents(workspace_id);
CREATE INDEX idx_agents_runtime ON agents(runtime_id);
CREATE INDEX idx_agents_status ON agents(workspace_id, status);
```

### 2.8 task_sessions

```sql
CREATE TABLE task_sessions (
    id TEXT PRIMARY KEY DEFAULT gen_random_id('tsk'),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    runtime_id TEXT NOT NULL REFERENCES runtimes(id) ON DELETE CASCADE,

    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'running', 'completed', 'failed'

    result TEXT,
    error TEXT,

    token_usage JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_task_sessions_workspace ON task_sessions(workspace_id);
CREATE INDEX idx_task_sessions_issue ON task_sessions(issue_id);
CREATE INDEX idx_task_sessions_agent ON task_sessions(agent_id);
CREATE INDEX idx_task_sessions_status ON task_sessions(workspace_id, status);
```

### 2.9 chat_sessions

```sql
CREATE TABLE chat_sessions (
    id TEXT PRIMARY KEY DEFAULT gen_random_id('cs'),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    issue_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_sessions_workspace ON chat_sessions(workspace_id);
CREATE INDEX idx_chat_sessions_agent ON chat_sessions(agent_id);
```

### 2.10 chat_messages

```sql
CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY DEFAULT gen_random_id('cm'),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,

    role TEXT NOT NULL,  -- 'user', 'agent', 'system'

    body TEXT NOT NULL,

    is_complete BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX idx_chat_messages_workspace ON chat_messages(workspace_id);
```

### 2.11 skills

```sql
CREATE TABLE skills (
    id TEXT PRIMARY KEY DEFAULT gen_random_id('skl'),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_skills_workspace ON skills(workspace_id);
```

### 2.12 agent_skills

```sql
CREATE TABLE agent_skills (
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    PRIMARY KEY (agent_id, skill_id)
);
```

### 2.13 inbox_items

```sql
CREATE TABLE inbox_items (
    id TEXT PRIMARY KEY DEFAULT gen_random_id('inx'),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    type TEXT NOT NULL,  -- 'issue_assigned', 'issue_mentioned', etc.

    title TEXT NOT NULL,
    body TEXT,

    actor_type TEXT,  -- 'user', 'agent', 'system'
    actor_id TEXT,

    issue_id TEXT REFERENCES issues(id) ON DELETE CASCADE,
    agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,

    read BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inbox_user ON inbox_items(user_id, read, created_at DESC);
CREATE INDEX idx_inbox_workspace ON inbox_items(workspace_id);
```

### 2.14 vectors (pgvector)

```sql
CREATE TABLE skill_embeddings (
    skill_id TEXT PRIMARY KEY REFERENCES skills(id) ON DELETE CASCADE,
    embedding vector(1536) NOT NULL
);

CREATE TABLE issue_embeddings (
    issue_id TEXT PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
    embedding vector(1536) NOT NULL
);
```

## 3. 迁移

```bash
# 创建迁移
make migrate-create NAME=add_issues_table

# 运行迁移
make migrate-up

# 回滚
make migrate-down
```

迁移文件位置: `server/migrations/`

## 4. 维护

### 4.1 清理

```sql
-- 清理 30 天前的 task sessions
DELETE FROM task_sessions
WHERE created_at < now() - interval '30 days'
  AND status IN ('completed', 'failed');

-- 清理过期的 inbox items
DELETE FROM inbox_items
WHERE created_at < now() - interval '90 days';
```

### 4.2 统计

```sql
-- Workspace 统计
SELECT
    w.name,
    COUNT(DISTINCT i.id) as issues,
    COUNT(DISTINCT a.id) as agents,
    COUNT(DISTINCT m.user_id) as members
FROM workspaces w
LEFT JOIN issues i ON i.workspace_id = w.id
LEFT JOIN agents a ON a.workspace_id = w.id
LEFT JOIN members m ON m.workspace_id = w.id
GROUP BY w.id;
```
