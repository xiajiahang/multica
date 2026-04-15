# Channels UI 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Channels 前端缺失功能：创建 Channel UI、DM 分组显示、未读计数 Badge

**Architecture:** 基于现有 `@multica/ui` Dialog 组件和 `useModalStore` 模式，在 `packages/views/channels/` 中添加 UI 功能

**Tech Stack:** React, Tailwind, TanStack Query, @multica/ui Dialog

---

## 文件结构

```
packages/views/channels/
├── components/
│   ├── index.ts                          # 导出所有组件
│   ├── channel-list.tsx                  # 已存在：侧边栏列表
│   ├── channel-window.tsx                # 已存在：消息窗口
│   ├── channels-page.tsx                 # 已存在：页面容器
│   ├── create-channel-dialog.tsx          # 新增：创建频道对话框
│   └── dm-section.tsx                   # 新增：DM 分组组件

packages/views/modals/
│   ├── registry.tsx                     # 已存在：需要注册新 modal
│   └── create-channel.tsx                # 新增：Modal 版本创建对话框

packages/core/channels/
│   ├── queries.ts                        # 已存在
│   ├── mutations.ts                      # 新增：useCreateChannel mutation
│   └── ws-updaters.ts                   # 已存在
```

---

## Task 1: 创建 CreateChannelDialog 组件

**Files:**
- Create: `packages/views/channels/components/create-channel-dialog.tsx`
- Modify: `packages/views/channels/components/index.ts`
- Modify: `packages/views/channels/components/channels-page.tsx`

- [ ] **Step 1: 创建 CreateChannelDialog 组件**

```tsx
"use client";

import { useState } from "react";
import { Hash, Lock, MessageSquare, X } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { useCreateChannel } from "@multica/core/channels/mutations";
import type { CreateChannelRequest } from "@multica/core/types";

interface CreateChannelDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (channelId: string) => void;
}

const CHANNEL_TYPES: { type: CreateChannelRequest["type"]; label: string; icon: React.ElementType }[] = [
  { type: "public", label: "Public", icon: Hash },
  { type: "private", label: "Private", icon: Lock },
  { type: "dm", label: "Direct Message", icon: MessageSquare },
];

export function CreateChannelDialog({ open, onClose, onSuccess }: CreateChannelDialogProps) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [type, setType] = useState<CreateChannelRequest["type"]>("public");
  const [submitting, setSubmitting] = useState(false);

  const createChannel = useCreateChannel();

  const handleSubmit = async () => {
    if (!name.trim() || submitting) return;
    if (type !== "dm" && !name.trim().startsWith("#")) {
      // DM channels don't need # prefix
    }
    setSubmitting(true);
    try {
      const channel = await createChannel.mutateAsync({
        name: type === "dm" ? name.trim() : name.trim(),
        type,
        topic: topic.trim() || undefined,
      });
      setName("");
      setTopic("");
      setType("public");
      onSuccess?.(channel.id);
      onClose();
      toast.success(`Channel #${channel.name} created`);
    } catch {
      toast.error("Failed to create channel");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[425px] p-0 gap-0">
        <DialogTitle className="sr-only">Create Channel</DialogTitle>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <span className="font-semibold">Create Channel</span>
          <button
            onClick={onClose}
            className="rounded-sm p-1 opacity-70 hover:opacity-100 hover:bg-accent/60 transition-all"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-4">
          {/* Channel type selector */}
          <div className="flex gap-2">
            {CHANNEL_TYPES.map(({ type: t, label, icon: Icon }) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md border text-sm transition-colors",
                  type === t
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:bg-accent/50",
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Name input */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Channel Name</label>
            <div className="relative">
              {type !== "dm" && (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">#</span>
              )}
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={type === "dm" ? "Username or email" : "channel-name"}
                className={type !== "dm" ? "pl-7" : ""}
              />
            </div>
          </div>

          {/* Topic input */}
          {type !== "dm" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Topic (optional)</label>
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="What's this channel about?"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || submitting}
          >
            {submitting ? "Creating..." : "Create Channel"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: 更新 channels-page.tsx 连接对话框**

```tsx
"use client";

import { useState } from "react";
import { ChannelList } from "./channel-list";
import { ChannelWindow } from "./channel-window";
import { CreateChannelDialog } from "./create-channel-dialog";

export function ChannelsPage() {
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const handleCreateSuccess = (channelId: string) => {
    setSelectedChannelId(channelId);
  };

  return (
    <div className="flex flex-1 min-h-0 h-full">
      {/* Sidebar */}
      <div className="w-64 shrink-0 border-r">
        <ChannelList
          selectedChannelId={selectedChannelId}
          onSelectChannel={setSelectedChannelId}
          onCreateChannel={() => setCreateOpen(true)}
        />
      </div>
      {/* Main content */}
      <div className="flex-1 min-h-0">
        <ChannelWindow
          channelId={selectedChannelId}
          onClose={() => setSelectedChannelId(null)}
        />
      </div>
      {/* Create dialog */}
      <CreateChannelDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}
```

- [ ] **Step 3: 更新 channel-list.tsx 连接 onCreateChannel**

修改 `ChannelList` 组件，将 `+` 按钮连接到 `onCreateChannel` 回调。

```tsx
// 在 ChannelList 组件中的 + 按钮处添加 onClick
{onCreateChannel && (
  <button
    onClick={onCreateChannel}
    className="text-muted-foreground hover:text-foreground"
    title="Create channel"
  >
    <span className="text-lg">+</span>
  </button>
)}
```

- [ ] **Step 4: 更新 channels/components/index.ts**

```ts
export { ChannelList } from "./channel-list";
export { ChannelWindow } from "./channel-window";
export { ChannelsPage } from "./channels-page";
export { CreateChannelDialog } from "./create-channel-dialog";
```

- [ ] **Step 5: 验证 TypeScript 类型检查**

```bash
cd /Users/xiajiahang/work/git-project/multica/.worktrees/channels-dm
pnpm typecheck
```

Expected: 无错误

- [ ] **Step 6: 提交代码**

```bash
git add packages/views/channels/components/create-channel-dialog.tsx \
        packages/views/channels/components/channels-page.tsx \
        packages/views/channels/components/channel-list.tsx \
        packages/views/channels/components/index.ts
git commit -m "feat(channels): add create channel dialog and wire up button"
```

---

## Task 2: 添加 useCreateChannel Mutation

**Files:**
- Modify: `packages/core/channels/mutations.ts`

- [ ] **Step 1: 检查现有 mutations.ts**

读取 `packages/core/channels/mutations.ts` 查看现有结构。

- [ ] **Step 2: 添加 useCreateChannel mutation**

在 mutations.ts 中添加：

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { channelKeys } from "./queries";
import type { CreateChannelRequest, Channel } from "../types";

export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateChannelRequest) => api.createChannel(data),
    onSuccess: (channel: Channel) => {
      // Invalidate channel list
      qc.invalidateQueries({ queryKey: channelKeys.all(channel.workspace_id) });
    },
  });
}
```

- [ ] **Step 3: 验证类型**

```bash
pnpm typecheck
```

- [ ] **Step 4: 提交**

```bash
git add packages/core/channels/mutations.ts
git commit -m "feat(core): add useCreateChannel mutation"
```

---

## Task 3: 添加 DM 分组显示

**Files:**
- Modify: `packages/views/channels/components/channel-list.tsx`

- [ ] **Step 1: 修改 ChannelList 支持分组显示**

在 ChannelList 中：
1. 将 channels 分为 `public/private` 组和 `dm` 组
2. 分别渲染分组标题和列表
3. DM 组显示用户头像而不是 # icon

```tsx
// 在 ChannelList 组件中
const publicChannels = channels.filter(c => c.type !== "dm");
const dmChannels = channels.filter(c => c.type === "dm");

// 渲染
return (
  <div className="flex flex-col h-full">
    {/* Public/Private channels */}
    <div className="py-2">
      {publicChannels.map((channel) => (
        <ChannelItem key={channel.id} channel={channel} ... />
      ))}
    </div>

    {/* DM channels */}
    {dmChannels.length > 0 && (
      <div className="border-t mt-2 pt-2">
        <div className="px-4 py-1 text-xs text-muted-foreground font-medium">
          Direct Messages
        </div>
        {dmChannels.map((channel) => (
          <ChannelItem key={channel.id} channel={channel} isDM ... />
        ))}
      </div>
    )}
  </div>
);
```

- [ ] **Step 2: 验证 TypeScript**

```bash
pnpm typecheck
```

- [ ] **Step 3: 提交**

```bash
git add packages/views/channels/components/channel-list.tsx
git commit -m "feat(channels): add DM section grouping in channel list"
```

---

## Task 4: 添加未读计数 Badge

**Files:**
- Modify: `packages/views/channels/components/channel-list.tsx`
- Modify: `packages/core/channels/queries.ts` 或 API 响应

- [ ] **Step 1: 理解未读计数逻辑**

未读计数 = 频道中 `last_read_at` 晚于 `last_message_at` 的消息数。
需要后端支持或前端计算。

当前 `Channel` 类型有 `last_message_at`，`ChannelMember` 有 `last_read_at`。
最简单的方案是：比较 `last_message_at` 和用户的 `last_read_at`。

- [ ] **Step 2: 在 ChannelList 中添加 badge 渲染**

```tsx
// 在 ChannelItem 中
const hasUnread = channel.last_message_at &&
  new Date(channel.last_message_at) > new Date(member?.last_read_at || 0);

return (
  <button ... >
    {/* ... channel info ... */}
    {hasUnread && (
      <span className="ml-auto size-2 rounded-full bg-primary" />
    )}
  </button>
);
```

注意：需要获取当前用户对每个频道的 `last_read_at`。可以通过 `channelMembersOptions` 获取。

- [ ] **Step 3: 验证 TypeScript**

```bash
pnpm typecheck
```

- [ ] **Step 4: 提交**

```bash
git add packages/views/channels/components/channel-list.tsx
git commit -m "feat(channels): add unread badge for channels with new messages"
```

---

## Task 5: 简化 Modal 注册（可选）

如果希望 CreateChannelDialog 也通过 `useModalStore` 注册为全局 modal：

**Files:**
- Create: `packages/views/modals/create-channel.tsx` (wrapper 版本)
- Modify: `packages/views/modals/registry.tsx`
- Modify: `packages/views/modals/index.ts` (如果存在)

- [ ] **Step 1: 创建 wrapper 版本**

```tsx
"use client";

import { CreateChannelDialog } from "../channels/components/create-channel-dialog";
import { useModalStore } from "@multica/core/modals";

export function CreateChannelModal() {
  const { data, close } = useModalStore((s) => ({
    data: s.data,
    close: s.close,
  }));

  return (
    <CreateChannelDialog
      open
      onClose={close}
      onSuccess={data?.onSuccess}
    />
  );
}
```

- [ ] **Step 2: 注册到 registry**

```tsx
// registry.tsx
import { CreateChannelModal } from "./create-channel";

switch (modal) {
  case "create-issue":
    return <CreateIssueModal onClose={close} data={data} />;
  case "create-channel":
    return <CreateChannelModal />;
  default:
    return null;
}
```

- [ ] **Step 3: 提交**

---

## 执行顺序

1. Task 2: 添加 useCreateChannel Mutation（依赖最少）
2. Task 1: 创建 CreateChannelDialog + 连接按钮（依赖 Task 2）
3. Task 3: DM 分组显示（独立，可并行）
4. Task 4: 未读计数 Badge（独立，可并行）
5. Task 5: Modal 注册（可选）

---

## 验证清单

- [ ] `pnpm typecheck` 通过
- [ ] `go build ./...` 通过
- [ ] 后端服务启动成功 (`DATABASE_URL=postgres://multica:multica@localhost:5432/multica_channels?sslmode=disable go run ./cmd/server`)
- [ ] 前端 `http://localhost:13735/channels` 可访问
- [ ] 可以创建 Public/Private/DM 频道
- [ ] DM 频道在 Direct Messages 分组中显示
- [ ] 有新消息的频道显示未读 badge
