"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, User, X, Plus, Search } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@multica/ui/components/ui/avatar";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@multica/ui/components/ui/popover";
import { ScrollArea } from "@multica/ui/components/ui/scroll-area";
import { useWorkspaceId } from "@multica/core/hooks";
import { useAuthStore } from "@multica/core/auth";
import { channelMembersOptions } from "@multica/core/channels/queries";
import { memberListOptions, agentListOptions } from "@multica/core/workspace/queries";
import {
  useAddChannelMember,
  useRemoveChannelMember,
} from "@multica/core/channels/mutations";

interface MemberPopoverProps {
  channelId: string;
}

export function MemberPopover({ channelId }: MemberPopoverProps) {
  const wsId = useWorkspaceId();
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");

  const { data: members = [] } = useQuery(channelMembersOptions(channelId));
  const { data: workspaceMembers = [] } = useQuery(memberListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));

  const addMember = useAddChannelMember();
  const removeMember = useRemoveChannelMember();

  const existingMemberIds = new Set(members.map((m) => m.member_id));

  // Filter workspace members/agents not already in channel
  const availableUsers = workspaceMembers.filter(
    (m) => !existingMemberIds.has(m.user_id),
  );
  const availableAgents = agents.filter(
    (a) => !existingMemberIds.has(a.id) && !a.archived_at,
  );

  // Search filter
  const searchLower = search.toLowerCase();
  const filteredUsers = search
    ? availableUsers.filter((m) =>
        m.name?.toLowerCase().includes(searchLower),
      )
    : availableUsers;
  const filteredAgents = search
    ? availableAgents.filter((a) =>
        a.name?.toLowerCase().includes(searchLower),
      )
    : availableAgents;

  const handleAdd = (memberType: "user" | "agent", memberId: string) => {
    addMember.mutate(
      { channelId, data: { member_type: memberType, member_id: memberId } },
      { onSuccess: () => setShowAdd(false) },
    );
  };

  const handleRemove = (memberType: string, memberId: string) => {
    removeMember.mutate({ channelId, memberType, memberId });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" className="gap-2">
            <User className="size-4" />
            {members.length}
          </Button>
        }
      />
      <PopoverContent className="w-72 p-0" align="end">
        {showAdd ? (
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Add Members</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowAdd(false);
                  setSearch("");
                }}
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search members..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <ScrollArea className="max-h-48">
              <div className="space-y-1">
                {filteredAgents.map((agent) => (
                  <button
                    key={agent.id}
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-md hover:bg-accent text-left"
                    onClick={() => handleAdd("agent", agent.id)}
                  >
                    <Avatar className="size-6">
                      <AvatarImage src={agent.avatar_url ?? undefined} />
                      <AvatarFallback className="bg-purple-100 text-purple-700 text-xs">
                        <Bot className="size-3" />
                      </AvatarFallback>
                    </Avatar>
                    <span>{agent.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto">Agent</span>
                  </button>
                ))}
                {filteredUsers.map((m) => (
                  <button
                    key={m.user_id}
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-md hover:bg-accent text-left"
                    onClick={() => handleAdd("user", m.user_id)}
                  >
                    <Avatar className="size-6">
                      <AvatarImage src={m.avatar_url ?? undefined} />
                      <AvatarFallback className="text-xs">
                        {m.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span>{m.name}</span>
                  </button>
                ))}
                {filteredUsers.length === 0 && filteredAgents.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2 text-center">
                    No members to add
                  </p>
                )}
              </div>
            </ScrollArea>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Members</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setShowAdd(true)}
              >
                <Plus className="size-3" />
                Add
              </Button>
            </div>
            <ScrollArea className="max-h-48">
              <div className="space-y-1">
                {members.map((member) => {
                  const isSelf = member.member_id === user?.id;
                  // Look up display name from workspace members / agents
                  const wsMember = workspaceMembers.find(
                    (m) => m.user_id === member.member_id,
                  );
                  const agent = agents.find((a) => a.id === member.member_id);
                  const displayName =
                    member.member_type === "agent"
                      ? agent?.name ?? "Agent"
                      : wsMember?.name ?? member.member_id.slice(0, 8);

                  return (
                    <div
                      key={member.id}
                      className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent"
                    >
                      <Avatar className="size-6">
                        {member.member_type === "agent" ? (
                          <>
                            <AvatarImage src={agent?.avatar_url ?? undefined} />
                            <AvatarFallback className="bg-purple-100 text-purple-700 text-xs">
                              <Bot className="size-3" />
                            </AvatarFallback>
                          </>
                        ) : (
                          <>
                            <AvatarImage src={wsMember?.avatar_url ?? undefined} />
                            <AvatarFallback className="text-xs">
                              {displayName.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </>
                        )}
                      </Avatar>
                      <span className="flex-1 truncate">{displayName}</span>
                      <span className="text-xs text-muted-foreground">
                        {member.role === "admin" ? "admin" : ""}
                      </span>
                      {!isSelf && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() =>
                            handleRemove(member.member_type, member.member_id)
                          }
                        >
                          <X className="size-3" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
