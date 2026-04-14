export interface Channel {
  id: string;
  workspace_id: string;
  name: string;
  type: "public" | "private" | "dm";
  topic: string;
  created_by: string;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChannelMember {
  id: string;
  channel_id: string;
  member_type: "user" | "agent";
  member_id: string;
  role: "admin" | "member";
  last_read_at: string | null;
  joined_at: string;
}

export interface ChannelMessage {
  id: string;
  channel_id: string;
  author_type: "user" | "agent";
  author_id: string;
  content: unknown; // Tiptap JSON
  attachments: unknown[];
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface ChannelIssue {
  id: string;
  channel_id: string;
  issue_id: string;
  linked_by: string;
  created_at: string;
}

export interface CreateChannelRequest {
  name: string;
  type: "public" | "private" | "dm";
  topic?: string;
}

export interface UpdateChannelRequest {
  name?: string;
  topic?: string;
}

export interface SendChannelMessageRequest {
  content: unknown; // Tiptap JSON
}

export interface SendChannelMessageResponse {
  message_id: string;
  task_id: string;
}

export interface CreateOrGetDMRequest {
  other_member_type: "user" | "agent";
  other_member_id: string;
}

export interface LinkChannelIssueRequest {
  issue_id: string;
}
