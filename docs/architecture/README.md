# Architecture Documentation

Multica 系统架构文档，面向架构师和产品设计师。

## 文档索引

| 文档 | 内容 |
|------|------|
| [01-OVERVIEW](01-OVERVIEW.md) | 系统全景、整体架构、技术选型、部署模式 |
| [02-FRONTEND](02-FRONTEND.md) | Frontend Monorepo 结构、Core/Views/UI 包详解、平台适配 |
| [03-DATA-MODEL](03-DATA-MODEL.md) | 核心数据实体、关系图、字段定义、索引策略 |
| [04-CORE-FLOWS](04-CORE-FLOWS.md) | Issue 生命周期、Agent 执行、Realtime 同步、多工作区 |
| [05-API](05-API.md) | REST API 路由、WebSocket 协议、认证、错误处理 |
| [06-DEPLOYMENT](06-DEPLOYMENT.md) | 开发环境、生产部署、Docker、CI/CD |
| [07-DATABASE](07-DATABASE.md) | PostgreSQL Schema、迁移、pgvector、维护 |

## 快速开始

1. 先读 [01-OVERVIEW](01-OVERVIEW.md) 了解整体架构
2. 根据需要深入 [02-FRONTEND](02-FRONTEND.md) 或 [03-DATA-MODEL](03-DATA-MODEL.md)
3. 理解核心流程看 [04-CORE-FLOWS](04-CORE-FLOWS.md)
4. API 细节看 [05-API](05-API.md)

## 核心设计决策

### 前后端分离
- Next.js 仅做 SPA，不做 SSR
- Go Backend 提供纯 API
- WebSocket 用于实时推送

### 跨平台代码共享
- `packages/core/` — 纯 TypeScript，无 UI 依赖
- `packages/views/` — 业务组件，无框架特定代码
- 平台差异通过适配层注入

### 状态管理
- TanStack Query = Server State
- Zustand = Client State
- WebSocket 事件触发 Query Invalidation

### 多租户
- Workspace 级别隔离
- 所有查询带 workspace_id
- 成员角色控制权限

## 相关文档

- [CLAUDE.md](../../CLAUDE.md) — 开发指南和编码规范
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — 贡献指南
- [SELF_HOSTING.md](../../SELF_HOSTING.md) — 自部署指南
