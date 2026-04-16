import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkspaceIdProvider } from "@multica/core/hooks";

const mockCreateChannel = vi.hoisted(() => vi.fn());
const mockCreateOrGetDM = vi.hoisted(() => vi.fn());
const mockToastSuccess = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/channels/mutations", () => ({
  useCreateChannel: () => ({ mutateAsync: mockCreateChannel }),
  useCreateOrGetDM: () => ({ mutateAsync: mockCreateOrGetDM }),
}));

vi.mock("@multica/core/api", () => ({
  api: {
    listMembers: vi.fn().mockResolvedValue([
      {
        id: "member-2",
        workspace_id: "ws-1",
        user_id: "user-2",
        role: "member",
        created_at: "2026-01-01T00:00:00Z",
        name: "Second User",
        email: "second@example.com",
        avatar_url: null,
      },
    ]),
    listAgents: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

vi.mock("@multica/ui/lib/utils", () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" "),
}));

vi.mock("@multica/ui/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@multica/ui/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
    size,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    size?: string;
    className?: string;
  }) => (
    <button data-variant={variant} data-size={size} className={className} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@multica/ui/components/ui/input", () => ({
  Input: ({
    value,
    onChange,
    placeholder,
    className,
    autoFocus,
  }: {
    value?: string;
    onChange?: (event: any) => void;
    placeholder?: string;
    className?: string;
    autoFocus?: boolean;
  }) => (
    <input
      autoFocus={autoFocus}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
    />
  ),
}));

vi.mock("@multica/ui/components/ui/avatar", () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AvatarFallback: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { CreateChannelDialog } from "./create-channel-dialog";

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">
        <CreateChannelDialog open onClose={vi.fn()} onSuccess={vi.fn()} />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  );
}

describe("CreateChannelDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateChannel.mockResolvedValue({ id: "channel-1", name: "general" });
    mockCreateOrGetDM.mockResolvedValue({ id: "dm-1", name: "dm" });
  });

  it("sends DM requests with member ids instead of user ids", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Direct Message" }));
    await user.click(await screen.findByRole("button", { name: /Second User/i }));

    await waitFor(() => {
      expect(mockCreateOrGetDM).toHaveBeenCalledWith({
        other_member_type: "user",
        other_member_id: "member-2",
      });
    });
  });
});
