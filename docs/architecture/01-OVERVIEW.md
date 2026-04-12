# Multica 系统架构全景

> 本文档旨在帮助架构师和产品设计师快速理解 Multica 整体架构，是后续深入各模块设计的基础参考。

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                        │
│  ┌─────────────────────┐              ┌─────────────────────┐              │
│  │    Web App          │              │   Desktop App       │              │
│  │   (Next.js 16)      │              │   (Electron)       │              │
│  │   App Router        │              │   electron-vite    │              │
│  └──────────┬──────────┘              └──────────┬──────────┘              │
│             │                                    │                         │
│             │    packages/views (共享业务组件)     │                         │
│             │    packages/core (共享状态/API)    │                         │
│             │    packages/ui (原子组件)          │                         │
└─────────────┼────────────────────────────────────┼─────────────────────────┘
              │                                    │
              │ HTTP/REST + WebSocket              │
              ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           GATEWAY LAYER                                     │
│                    apps/web/platform (Next.js API routes)                   │
│                    apps/desktop/src/renderer/src/platform/                  │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              │ internal/proxy
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           GO BACKEND :8080                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         Chi Router                                    │  │
│  │  /api/v1/* → handlers  │  /ws/* → websocket  │  /realtime/*          │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │  handlers/  │  │   service/  │  │   storage/  │  │   daemon/   │       │
│  │  (HTTP)    │  │  (业务逻辑)  │  │  (DB访问)   │  │  (Agent运行)│       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                          │
│  │  realtime/  │  │  middleware/│  │    cli/     │                          │
│  │  (WS广播)   │  │  (认证/日志) │  │  (命令行)   │                          │
│  └─────────────┘  └─────────────┘  └─────────────┘                          │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              │ sqlc (类型安全的 SQL)
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PostgreSQL 17 + pgvector                               │
│   workspaces │ issues │ agents │ runtimes │ chat │ inbox │ skills           │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2. 技术选型

| 层级 | 技术栈 | 说明 |
|------|--------|------|
| Web Frontend | Next.js 16 (App Router) | SSR + SPA 混合 |
| Desktop Frontend | Electron + electron-vite | 跨平台桌面 |
| Frontend Monorepo | pnpm workspaces + Turborepo | 统一依赖管理 |
| Backend | Go 1.26+ (Chi router) | 轻量 HTTP 框架 |
| Database | PostgreSQL 17 + pgvector | 向量存储支持 AI |
| DB Access | sqlc | 类型安全的 SQL 生成 |
| Realtime | gorilla/websocket | WebSocket 长连接 |
| Agent Runtime | Local Daemon | Claude Code / Codex / OpenClaw / OpenCode |
| State (Server) | TanStack Query | 服务端状态管理 |
| State (Client) | Zustand | 纯客户端状态 |

## 3. 核心设计原则

### 3.1 前后端分离
- 前端不依赖后端渲染，后端专注 API + 业务逻辑
- WebSocket 用于实时事件推送，HTTP REST 用于请求/响应

### 3.2 跨平台代码共享
- `packages/core/` — 纯业务逻辑，无 UI 依赖
- `packages/views/` — 共享页面组件，无框架特定代码
- `packages/ui/` — 原子 UI 组件，无业务逻辑

### 3.3 状态管理原则
- **TanStack Query** = Server State（唯一数据源）
- **Zustand** = Client State（UI 状态）
- WebSocket 事件通过 Query Invalidation 触发更新，不直接写 store

### 3.4 多租户架构
- 所有查询按 `workspace_id` 过滤
- 成员角色（owner/admin/member）控制权限

## 4. 目录结构

```
multica/
├── apps/
│   ├── web/                    # Next.js Web 应用
│   │   ├── app/                # App Router 页面
│   │   └── platform/            # 平台适配层（cookie, next/navigation）
│   │
│   └── desktop/                 # Electron 桌面应用
│       └── renderer/src/platform/  # 平台适配层（react-router-dom）
│
├── packages/
│   ├── core/                   # 核心业务逻辑（无 UI 依赖）
│   ├── ui/                    # 原子 UI 组件
│   ├── views/                 # 共享业务页面
│   └── tsconfig/              # TypeScript 配置
│
├── server/                     # Go 后端
│   ├── cmd/                   # 入口点
│   ├── internal/
│   │   ├── handler/           # HTTP handlers
│   │   ├── service/           # 业务逻辑
│   │   ├── storage/           # 数据库访问层
│   │   ├── daemon/            # Agent 运行时管理
│   │   ├── realtime/          # WebSocket 处理
│   │   ├── middleware/        # 中间件（认证、日志）
│   │   └── cli/               # CLI 命令
│   ├── migrations/            # 数据库迁移
│   └── pkg/                   # 内部包
│
├── docs/                       # 文档
├── e2e/                        # Playwright E2E 测试
└── scripts/                    # 脚本
```

## 5. 包边界规则（硬约束）

| 包 | 可以依赖 | 禁止依赖 |
|---|---------|---------|
| `packages/core/` | 纯 TS 库 | react-dom, ui, views, next/*, react-router-dom, localStorage |
| `packages/ui/` | 纯 TS 库 | core, views, next/*, react-router-dom |
| `packages/views/` | core, ui | next/*, react-router-dom, stores |
| `apps/web/` | core, views, ui | 无 |
| `apps/desktop/` | core, views, ui | 无 |

**违反边界规则会破坏跨平台架构。**

## 6. 部署模式

### 6.1 本地开发
```
┌──────────────┐
│  Next.js :3000 │ ← Web App (pnpm dev:web)
├──────────────┤
│  Go :8080      │ ← Backend API (make server)
├──────────────┤
│  Daemon       │ ← 本地 Agent 运行时 (make daemon)
├──────────────┤
│  PostgreSQL   │ ← Docker (make db-up)
└──────────────┘
```

### 6.2 生产部署
```
┌──────────────────────────────────────┐
│  Next.js (静态导出 或 Vercel)        │
├──────────────────────────────────────┤
│  Go Backend (Docker / K8s)          │
├──────────────────────────────────────┤
│  PostgreSQL (Supabase / 云数据库)     │
└──────────────────────────────────────┘
       │
       │ 可选
       ▼
┌──────────────┐
│ Daemon       │ ← 用户本地机器运行
└──────────────┘
```
