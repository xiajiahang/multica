# Frontend 架构详解

## 1. Monorepo 结构

```
packages/
├── core/          # 核心业务逻辑（零 UI 依赖）
│   ├── api/           client.ts (fetch 封装) + ws-client.ts (WebSocket)
│   ├── auth/          store.ts (认证状态: token, user info)
│   ├── issues/        queries.ts (GET) + mutations.ts (POST/PATCH/DELETE) + stores/
│   ├── chat/          queries.ts + mutations.ts + store.ts
│   ├── inbox/         queries.ts + mutations.ts
│   ├── runtimes/      queries.ts + mutations.ts
│   ├── pins/          queries.ts + mutations.ts
│   ├── realtime/      hooks.ts (WS 事件 → Query Invalidation)
│   ├── workspace/     store.ts + queries.ts
│   ├── navigation/    store.ts (路由历史管理)
│   ├── modals/        store.ts (弹窗状态)
│   └── platform/      StorageAdapter (抽象 localStorage)
│
├── ui/            # 原子 UI 组件（零业务逻辑）
│   └── components/ui/
│       ├── button.tsx
│       ├── input.tsx
│       ├── dialog.tsx
│       └── ... (shadcn/base-ui)
│
└── views/         # 共享业务页面（零框架特定代码）
    ├── issues/
    │   ├── components/
    │   │   ├── board-view.tsx
    │   │   ├── list-view.tsx
    │   │   ├── issue-detail.tsx
    │   │   ├── board-column.tsx
    │   │   ├── board-card.tsx
    │   │   ├── list-row.tsx
    │   │   ├── comment-card.tsx
    │   │   ├── comment-input.tsx
    │   │   ├── reply-input.tsx
    │   │   ├── batch-action-toolbar.tsx
    │   │   ├── issues-header.tsx
    │   │   ├── infinite-scroll-sentinel.tsx
    │   │   ├── agent-live-card.tsx
    │   │   ├── agent-transcript-dialog.tsx
    │   │   ├── issue-mention-card.tsx
    │   │   └── pickers/
    │   │       ├── assignee-picker.tsx
    │   │       ├── status-picker.tsx
    │   │       ├── priority-picker.tsx
    │   │       ├── due-date-picker.tsx
    │   │       └── property-picker.tsx
    │   ├── issues-page.tsx
    │   └── issues-page.test.tsx
    │
    ├── agents/
    │   ├── components/
    │   │   ├── agents-page.tsx
    │   │   ├── agent-list-item.tsx
    │   │   ├── agent-detail.tsx
    │   │   ├── create-agent-dialog.tsx
    │   │   └── tabs/
    │   │       ├── tasks-tab.tsx
    │   │       ├── instructions-tab.tsx
    │   │       ├── skills-tab.tsx
    │   │       └── settings-tab.tsx
    │
    ├── chat/
    │   ├── components/
    │   │   ├── chat-window.tsx
    │   │   ├── chat-message-list.tsx
    │   │   ├── chat-input.tsx
    │   │   ├── chat-session-history.tsx
    │   │   └── chat-fab.tsx
    │
    ├── inbox/
    │   ├── components/
    │   │   ├── inbox-page.tsx
    │   │   ├── inbox-list-item.tsx
    │   │   └── inbox-detail-label.tsx
    │
    ├── runtimes/
    │   ├── components/
    │   │   ├── runtimes-page.tsx
    │   │   ├── runtime-list.tsx
    │   │   ├── runtime-detail.tsx
    │   │   ├── ping-section.tsx
    │   │   ├── update-section.tsx
    │   │   ├── usage-section.tsx
    │   │   ├── provider-logo.tsx
    │   │   ├── charts/
    │   │   │   ├── activity-heatmap.tsx
    │   │   │   ├── daily-cost-chart.tsx
    │   │   │   ├── daily-token-chart.tsx
    │   │   │   ├── hourly-activity-chart.tsx
    │   │   │   └── model-distribution-chart.tsx
    │   │   └── shared.tsx
    │
    ├── layout/
    │   ├── dashboard-layout.tsx
    │   ├── app-sidebar.tsx
    │   └── dashboard-guard.tsx
    │
    ├── modals/
    │   ├── create-issue.tsx
    │   ├── create-issue.test.tsx
    │   ├── create-workspace.tsx
    │   └── registry.tsx
    │
    ├── auth/
    │   ├── login-page.tsx
    │   └── login-page.test.tsx
    │
    ├── navigation/
    │   ├── app-link.tsx
    │   └── context.tsx
    │
    ├── common/
    │   ├── actor-avatar.tsx
    │   └── markdown.tsx
    │
    ├── editor/
    │   ├── content-editor.tsx
    │   ├── title-editor.tsx
    │   ├── readonly-content.tsx
    │   ├── file-drop-overlay.tsx
    │   └── extensions/
    │       ├── mention-view.tsx
    │       ├── mention-suggestion.tsx
    │       ├── file-card.tsx
    │       ├── image-view.tsx
    │       └── code-block-view.tsx
    │
    ├── projects/
    │   ├── components/
    │   │   ├── projects-page.tsx
    │   │   ├── project-detail.tsx
    │   │   └── project-picker.tsx
    │
    ├── search/
    │   ├── search-command.tsx
    │   ├── search-command.test.tsx
    │   └── search-trigger.tsx
    │
    ├── settings/
    │   └── components/
    │       ├── settings-page.tsx
    │       ├── account-tab.tsx
    │       ├── appearance-tab.tsx
    │       ├── workspace-tab.tsx
    │       ├── members-tab.tsx
    │       ├── tokens-tab.tsx
    │       └── repositories-tab.tsx
    │
    ├── skills/
    │   ├── components/
    │   │   ├── skills-page.tsx
    │   │   ├── file-tree.tsx
    │   │   └── file-viewer.tsx
    │
    └── my-issues/
        └── components/
            ├── my-issues-page.tsx
            └── my-issues-header.tsx

apps/
├── web/
│   ├── app/
│   │   ├── (auth)/
│   │   │   └── login/
│   │   │       └── page.tsx
│   │   ├── (dashboard)/
│   │   │   ├── issues/
│   │   │   │   ├── page.tsx
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx
│   │   │   ├── settings/
│   │   │   ├── agents/
│   │   │   └── ...
│   │   └── layout.tsx
│   └── platform/
│       ├── query-client-provider.tsx
│       ├── core-provider.tsx
│       └── navigation-adapter.tsx
│
└── desktop/
    └── renderer/src/
        └── platform/
            ├── query-client-provider.tsx
            ├── core-provider.tsx
            └── navigation-adapter.tsx
```

## 2. Core 包详解

### 2.1 API Client

```typescript
// packages/core/api/client.ts
// 基于 fetch 的 HTTP 客户端，自动携带认证 token

// packages/core/api/ws-client.ts
// WebSocket 客户端，处理连接、断线重连、心跳
```

### 2.2 TanStack Query 使用模式

```typescript
// 每个实体都有标准的 queries + mutations 文件

// packages/core/issues/queries.ts
export const issuesKeys = {
  all: ['issues'] as const,
  list: (wsId: string) => [...issuesKeys.all, 'list', wsId] as const,
  detail: (wsId: string, id: string) => [...issuesKeys.all, 'detail', wsId, id] as const,
}

export function useIssues(wsId: string) {
  return useQuery({
    queryKey: issuesKeys.list(wsId),
    queryFn: () => api.get(`/workspaces/${wsId}/issues`),
  })
}

// packages/core/issues/mutations.ts
export function useCreateIssue() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data) => api.post('/workspaces/${data.wsId}/issues', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: issuesKeys.all })
    },
  })
}
```

### 2.3 Zustand Store 模式

```typescript
// packages/core/issues/stores/selection-store.ts

interface SelectionStore {
  selectedIssueId: string | null
  selectedAgentId: string | null
  setSelectedIssue: (id: string | null) => void
  setSelectedAgent: (id: string | null) => void
}

// 硬规则: selector 必须返回稳定引用
// 错误: s => ({ issueId: s.selectedIssueId, agentId: s.selectedAgentId })
// 正确: 分别选择 primitive 值
```

### 2.4 Platform 抽象

```typescript
// packages/core/platform/types.ts
export interface PlatformConfig {
  storage: StorageAdapter
  navigate: (path: string) => void
  wsUrl: string
}

// packages/core/platform/index.ts
// CoreProvider 接收 PlatformConfig，为 core 包所有模块提供平台特定实现
```

## 3. Views 包详解

### 3.1 页面组件结构

每个页面组件遵循统一结构：

```
issues/
├── components/
│   ├── board-view.tsx      # 看板视图主组件
│   ├── list-view.tsx       # 列表视图主组件
│   ├── issue-detail.tsx    # 详情侧边栏
│   ├── board-column.tsx    # 看板列组件
│   ├── board-card.tsx      # 看板卡片组件
│   ├── list-row.tsx        # 列表行组件
│   └── pickers/            # 选择器组件
├── issues-page.tsx         # 页面入口
└── issues-page.test.tsx   # 测试
```

### 3.2 路由集成

`views` 包中的页面通过 `NavigationAdapter` 进行路由跳转：

```typescript
// packages/views/navigation/context.tsx
export const NavigationContext = createContext<NavigationAdapter | null>(null)

// 使用方式
const navigation = useContext(NavigationContext)
navigation?.push('/issues/123')
```

## 4. UI 包详解

### 4.1 组件来源

- 基于 **shadcn/ui** + **Base UI** (@base-ui/react)
- 配置: `packages/ui/components.json`
- 样式风格: `base-nova`

### 4.2 共享样式

```
packages/ui/styles/
├── globals.css
└── tokens/
    └── semantic colors (bg-background, text-muted-foreground, etc.)
```

## 5. 平台适配层

### 5.1 Web Platform (apps/web/platform/)

```typescript
// 职责:
// - 包装 Next.js 特定 API
// - 处理 cookies
// - 提供 CoreProvider 实现

// NavigationAdapter 实现
// - 使用 next/navigation
```

### 5.2 Desktop Platform (apps/desktop/src/renderer/src/platform/)

```typescript
// 职责:
// - 包装 react-router-dom
// - 处理 Electron IPC

// NavigationAdapter 实现
// - 使用 react-router-dom
```

### 5.3 CoreProvider 注入

```typescript
// apps/web/platform/core-provider.tsx
<CoreProvider
  config={{
    storage: new NextStorageAdapter(),   // cookies + localStorage
    navigate: (path) => router.push(path),
    wsUrl: '/ws',
  }}
>
  {children}
</CoreProvider>

// apps/desktop/platform/core-provider.tsx
<CoreProvider
  config={{
    storage: new ElectronStorageAdapter(), // electron store
    navigate: (path) => history.push(path),
    wsUrl: 'ws://localhost:8080/ws',
  }}
>
  {children}
</CoreProvider>
```

## 6. CSS 架构

```
packages/ui/styles/
├── globals.css           # Tailwind base + custom styles
└── tokens/               # Design tokens (semantic colors)

apps/web/app/globals.css
apps/desktop/src/renderer/src/globals.css
# 都 @source packages/ui/styles
```

**规则:**
- 使用语义化 token: `bg-background`, `text-muted-foreground`
- 禁止硬编码颜色: `text-red-500`, `bg-gray-100`
- 共享样式只放在 `packages/ui/styles/`
