# 部署模式

## 1. 环境概述

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Development                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │ Next.js     │  │ Go Backend   │  │ PostgreSQL  │  │   Daemon    │       │
│  │ :3000       │  │ :8080        │  │ :5432        │  │  :7890      │       │
│  │ (pnpm dev)  │  │ (make server)│  │ (Docker)    │  │ (make daemon│       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Shared localhost PostgreSQL                       │   │
│  │                         (make db-up)                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           Production                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        Static/CDN                                     │   │
│  │                    (Vercel / Cloudflare)                              │   │
│  │                      Next.js Export                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    │ HTTP / WebSocket                       │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Go Backend                                   │   │
│  │                    (Docker / K8s / VPS)                               │   │
│  │                         :8080                                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    PostgreSQL 17 + pgvector                          │   │
│  │                   (Supabase / Railway / Neon)                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Daemon (Optional)                             │   │
│  │                    (User's Local Machine)                            │   │
│  │                     Claude Code / Codex CLI                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2. Worktree 支持

Multica 支持 Git worktree 开发，每个 worktree 独立运行：

### 2.1 隔离机制

```
主 checkout (.env)
├── DB: multica
└── Ports: 3000, 8080

worktree-A (.env.worktree)
├── DB: multica_worktree_a
└── Ports: 3001, 8081

worktree-B (.env.worktree)
├── DB: multica_worktree_b
└── Ports: 3002, 8082
```

### 2.2 自动检测

```bash
make dev  # 自动检测 worktree，设置独立 env 和端口
```

## 3. Docker 部署

### 3.1 服务构成

```yaml
# docker-compose.yml
services:
  postgres:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_DB: multica
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  app:
    build: .
    depends_on:
      - postgres
    environment:
      DATABASE_URL: postgres://multica:${DB_PASSWORD}@postgres:5432/multica
      JWT_SECRET: ${JWT_SECRET}
    ports:
      - "8080:8080"
```

### 3.2 构建

```bash
# 构建镜像
docker build -t multica .

# 运行
docker run -d -p 8080:8080 \
  -e DATABASE_URL=postgres://... \
  -e JWT_SECRET=... \
  multica
```

## 4. 前端部署

### 4.1 Web App

```bash
# 构建静态导出
pnpm --filter @multica/web build

# 输出: apps/web/.next/
# 可部署到任意静态托管
```

### 4.2 跨域 API 配置

```typescript
// apps/web/next.config.js
{
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'https://api.multica.ai/:path*'
      },
      {
        source: '/ws/:path*',
        destination: 'https://api.multica.ai/ws/:path*'
      }
    ]
  }
}
```

## 5. 环境变量

### 5.1 后端

```bash
# .env
DATABASE_URL=postgres://user:pass@localhost:5432/multica
JWT_SECRET=your-secret-key
WS_SECRET=your-ws-secret

# 可选
OPENAI_API_KEY=sk-...      # 如果使用 OpenAI
ANTHROPIC_API_KEY=sk-ant-... # 如果使用 Claude
```

### 5.2 前端

```bash
# .env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080
```

## 6. CI/CD

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg17
        env:
          POSTGRES_DB: test
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.26.1'

      - name: Install deps
        run: pnpm install

      - name: Type check
        run: pnpm typecheck

      - name: Test
        run: pnpm test

      - name: Go test
        run: cd server && go test ./...

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t multica .
```

## 7. 监控与日志

### 7.1 日志

```go
// server/internal/logger/
// 结构化日志 (JSON 格式)

{
  "level": "info",
  "ts": "2024-01-01T00:00:00Z",
  "msg": "request completed",
  "method": "GET",
  "path": "/api/v1/workspaces",
  "status": 200,
  "duration": "45ms"
}
```

### 7.2 健康检查

```http
GET /health

{
  "status": "ok",
  "version": "0.1.0",
  "db": "connected"
}
```

## 8. 发布流程

```bash
# 1. 创建 tag
git tag v0.1.0

# 2. 推送 tag
git push origin v0.1.0

# 3. GitHub Actions 自动触发
#    - 运行测试
#    - 构建多平台二进制
#    - 发布到 GitHub Releases
#    - 发布到 Homebrew tap
```
