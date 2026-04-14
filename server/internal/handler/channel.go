package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// ---------------------------------------------------------------------------
// Channel CRUD
// ---------------------------------------------------------------------------

type CreateChannelRequest struct {
	Name  string `json:"name"`
	Type  string `json:"type"` // public, private, dm
	Topic string `json:"topic"`
}

func (h *Handler) ListChannels(w http.ResponseWriter, r *http.Request) {
	workspaceID := ctxWorkspaceID(r.Context())
	userID, _ := requireUserID(w, r)

	rows, err := h.DB.Query(r.Context(), `
		SELECT c.id, c.workspace_id, c.name, c.type, c.topic, c.created_by, c.last_message_at, c.created_at, c.updated_at,
			COALESCE(
				(SELECT COUNT(*) FROM messages m
				 WHERE m.channel_id = c.id
				 AND m.created_at > COALESCE(cm.last_read_at, '-infinity'::timestamptz)),
				0
			)::int AS unread_count
		FROM channels c
		LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.member_type = 'user' AND cm.member_id = $2
		WHERE c.workspace_id = $1
		ORDER BY c.last_message_at DESC NULLS LAST
	`, parseUUID(workspaceID), parseUUID(userID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list channels")
		return
	}
	defer rows.Close()

	type channelWithUnread struct {
		ch          db.Channel
		unreadCount int
	}
	var channels []channelWithUnread
	for rows.Next() {
		var ch db.Channel
		var unread int
		if err := rows.Scan(&ch.ID, &ch.WorkspaceID, &ch.Name, &ch.Type, &ch.Topic, &ch.CreatedBy, &ch.LastMessageAt, &ch.CreatedAt, &ch.UpdatedAt, &unread); err != nil {
			continue
		}
		channels = append(channels, channelWithUnread{ch: ch, unreadCount: unread})
	}

	resp := make([]ChannelResponse, len(channels))
	for i, c := range channels {
		r := channelToResponse(c.ch)
		r.UnreadCount = c.unreadCount
		resp[i] = r
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) CreateChannel(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())

	var req CreateChannelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.Type == "" {
		req.Type = "public"
	}
	if req.Type != "public" && req.Type != "private" && req.Type != "dm" {
		writeError(w, http.StatusBadRequest, "type must be public, private, or dm")
		return
	}

	var channel db.Channel
	err := h.DB.QueryRow(r.Context(), `
		INSERT INTO channels (workspace_id, name, type, topic, created_by)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, workspace_id, name, type, topic, created_by, last_message_at, created_at, updated_at
	`, parseUUID(workspaceID), req.Name, req.Type, req.Topic, parseUUID(userID)).Scan(
		&channel.ID, &channel.WorkspaceID, &channel.Name, &channel.Type, &channel.Topic,
		&channel.CreatedBy, &channel.LastMessageAt, &channel.CreatedAt, &channel.UpdatedAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create channel")
		return
	}

	// Auto-join the creator as admin.
	h.DB.Exec(r.Context(), `
		INSERT INTO channel_members (channel_id, member_type, member_id, role)
		VALUES ($1, 'user', $2, 'admin')
	`, channel.ID, parseUUID(userID))

	h.publish(protocol.EventChannelCreated, workspaceID, "member", userID, map[string]any{
		"channel": channelToResponse(channel),
	})
	writeJSON(w, http.StatusCreated, channelToResponse(channel))
}

func (h *Handler) GetChannel(w http.ResponseWriter, r *http.Request) {
	workspaceID := ctxWorkspaceID(r.Context())
	channelID := chi.URLParam(r, "channelId")

	var channel db.Channel
	err := h.DB.QueryRow(r.Context(), `
		SELECT id, workspace_id, name, type, topic, created_by, last_message_at, created_at, updated_at
		FROM channels WHERE id = $1 AND workspace_id = $2
	`, parseUUID(channelID), parseUUID(workspaceID)).Scan(
		&channel.ID, &channel.WorkspaceID, &channel.Name, &channel.Type, &channel.Topic,
		&channel.CreatedBy, &channel.LastMessageAt, &channel.CreatedAt, &channel.UpdatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			writeError(w, http.StatusNotFound, "channel not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get channel")
		return
	}

	writeJSON(w, http.StatusOK, channelToResponse(channel))
}

func (h *Handler) UpdateChannel(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	channelID := chi.URLParam(r, "channelId")

	var req struct {
		Name  *string `json:"name"`
		Topic *string `json:"topic"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var channel db.Channel
	err := h.DB.QueryRow(r.Context(), `
		UPDATE channels
		SET name = COALESCE($2, name),
		    topic = COALESCE($3, topic),
		    updated_at = NOW()
		WHERE id = $1
		RETURNING id, workspace_id, name, type, topic, created_by, last_message_at, created_at, updated_at
	`, parseUUID(channelID), req.Name, req.Topic).Scan(
		&channel.ID, &channel.WorkspaceID, &channel.Name, &channel.Type, &channel.Topic,
		&channel.CreatedBy, &channel.LastMessageAt, &channel.CreatedAt, &channel.UpdatedAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update channel")
		return
	}

	h.publish(protocol.EventChannelUpdated, workspaceID, "member", userID, map[string]any{
		"channel": channelToResponse(channel),
	})
	writeJSON(w, http.StatusOK, channelToResponse(channel))
}

func (h *Handler) DeleteChannel(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	channelID := chi.URLParam(r, "channelId")

	_, err := h.DB.Exec(r.Context(), `DELETE FROM channels WHERE id = $1`, parseUUID(channelID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete channel")
		return
	}

	h.publish(protocol.EventChannelDeleted, workspaceID, "member", userID, map[string]any{
		"channel_id": channelID,
	})
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// Channel Members
// ---------------------------------------------------------------------------

func (h *Handler) ListChannelMembers(w http.ResponseWriter, r *http.Request) {
	workspaceID := ctxWorkspaceID(r.Context())
	channelID := chi.URLParam(r, "channelId")

	// Verify channel exists.
	var exists bool
	h.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM channels WHERE id = $1 AND workspace_id = $2)`,
		parseUUID(channelID), parseUUID(workspaceID)).Scan(&exists)
	if !exists {
		writeError(w, http.StatusNotFound, "channel not found")
		return
	}

	rows, err := h.DB.Query(r.Context(), `
		SELECT id, channel_id, member_type, member_id, role, last_read_at, joined_at
		FROM channel_members WHERE channel_id = $1
	`, parseUUID(channelID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list members")
		return
	}
	defer rows.Close()

	var members []db.ChannelMember
	for rows.Next() {
		var m db.ChannelMember
		if err := rows.Scan(&m.ID, &m.ChannelID, &m.MemberType, &m.MemberID, &m.Role, &m.LastReadAt, &m.JoinedAt); err != nil {
			continue
		}
		members = append(members, m)
	}

	resp := make([]ChannelMemberResponse, len(members))
	for i, m := range members {
		resp[i] = channelMemberToResponse(m)
	}
	writeJSON(w, http.StatusOK, resp)
}

type AddChannelMemberRequest struct {
	MemberType string `json:"member_type"` // user or agent
	MemberID   string `json:"member_id"`
	Role       string `json:"role"` // admin or member
}

func (h *Handler) AddChannelMember(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	channelID := chi.URLParam(r, "channelId")

	var req AddChannelMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.MemberType != "user" && req.MemberType != "agent" {
		writeError(w, http.StatusBadRequest, "member_type must be user or agent")
		return
	}
	if req.Role == "" {
		req.Role = "member"
	}

	var member db.ChannelMember
	err := h.DB.QueryRow(r.Context(), `
		INSERT INTO channel_members (channel_id, member_type, member_id, role)
		VALUES ($1, $2, $3, $4)
		RETURNING id, channel_id, member_type, member_id, role, last_read_at, joined_at
	`, parseUUID(channelID), req.MemberType, parseUUID(req.MemberID), req.Role).Scan(
		&member.ID, &member.ChannelID, &member.MemberType, &member.MemberID, &member.Role, &member.LastReadAt, &member.JoinedAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add member")
		return
	}

	h.publish(protocol.EventChannelMemberJoined, workspaceID, "member", userID, map[string]any{
		"channel_id":  channelID,
		"member_type": req.MemberType,
		"member_id":   req.MemberID,
	})
	writeJSON(w, http.StatusCreated, channelMemberToResponse(member))
}

func (h *Handler) RemoveChannelMember(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	channelID := chi.URLParam(r, "channelId")
	memberType := chi.URLParam(r, "memberType")
	memberID := chi.URLParam(r, "memberId")

	_, err := h.DB.Exec(r.Context(), `
		DELETE FROM channel_members WHERE channel_id = $1 AND member_type = $2 AND member_id = $3
	`, parseUUID(channelID), memberType, parseUUID(memberID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to remove member")
		return
	}

	h.publish(protocol.EventChannelMemberLeft, workspaceID, "member", userID, map[string]any{
		"channel_id":  channelID,
		"member_type": memberType,
		"member_id":   memberID,
	})
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

type SendChannelMessageRequest struct {
	Content json.RawMessage `json:"content"` // Tiptap JSON
}

type SendChannelMessageResponse struct {
	MessageID string `json:"message_id"`
	TaskID    string `json:"task_id,omitempty"`
}

func (h *Handler) ListChannelMessages(w http.ResponseWriter, r *http.Request) {
	channelID := chi.URLParam(r, "channelId")

	cursor := r.URL.Query().Get("cursor")
	limitStr := r.URL.Query().Get("limit")

	limit := int64(50)
	if limitStr != "" {
		if l, err := strconv.ParseInt(limitStr, 10, 64); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	var rows pgx.Rows
	var err error

	if cursor != "" {
		cursorTime, _ := time.Parse(time.RFC3339Nano, cursor)
		rows, err = h.DB.Query(r.Context(), `
			SELECT id, channel_id, author_type, author_id, content, attachments, edited_at, deleted_at, created_at
			FROM messages
			WHERE channel_id = $1 AND created_at < $2
			ORDER BY created_at DESC
			LIMIT $3
		`, parseUUID(channelID), cursorTime, limit)
	} else {
		rows, err = h.DB.Query(r.Context(), `
			SELECT id, channel_id, author_type, author_id, content, attachments, edited_at, deleted_at, created_at
			FROM messages
			WHERE channel_id = $1
			ORDER BY created_at DESC
			LIMIT $2
		`, parseUUID(channelID), limit)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list messages")
		return
	}
	defer rows.Close()

	var messages []db.Message
	for rows.Next() {
		var m db.Message
		if err := rows.Scan(&m.ID, &m.ChannelID, &m.AuthorType, &m.AuthorID, &m.Content, &m.Attachments, &m.EditedAt, &m.DeletedAt, &m.CreatedAt); err != nil {
			continue
		}
		messages = append(messages, m)
	}

	resp := make([]MessageResponse, len(messages))
	for i, m := range messages {
		resp[i] = messageToResponse(m)
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) SendChannelMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	channelID := chi.URLParam(r, "channelId")

	var req SendChannelMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.Content) == 0 {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}

	// Verify user is a channel member.
	var memberExists bool
	h.DB.QueryRow(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM channel_members WHERE channel_id = $1 AND member_type = 'user' AND member_id = $2)
	`, parseUUID(channelID), parseUUID(userID)).Scan(&memberExists)
	if !memberExists {
		writeError(w, http.StatusForbidden, "not a channel member")
		return
	}

	// Insert message.
	var msg db.Message
	err := h.DB.QueryRow(r.Context(), `
		INSERT INTO messages (channel_id, author_type, author_id, content)
		VALUES ($1, 'user', $2, $3)
		RETURNING id, channel_id, author_type, author_id, content, attachments, edited_at, deleted_at, created_at
	`, parseUUID(channelID), parseUUID(userID), req.Content).Scan(
		&msg.ID, &msg.ChannelID, &msg.AuthorType, &msg.AuthorID, &msg.Content,
		&msg.Attachments, &msg.EditedAt, &msg.DeletedAt, &msg.CreatedAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create message")
		return
	}

	// Update last_message_at.
	h.DB.Exec(r.Context(), `UPDATE channels SET last_message_at = NOW() WHERE id = $1`, parseUUID(channelID))

	// Get author name for broadcast.
	authorName := ""
	var memberName string
	if err := h.DB.QueryRow(r.Context(), `SELECT name FROM members WHERE id = $1`, parseUUID(userID)).Scan(&memberName); err == nil {
		authorName = memberName
	}

	// Broadcast the message.
	h.publish(protocol.EventChannelMessageNew, workspaceID, "member", userID, protocol.ChannelMessagePayload{
		ChannelID: channelID,
		Message: protocol.MessageData{
			ID:         uuidToString(msg.ID),
			AuthorType: "user",
			AuthorID:   userID,
			AuthorName: authorName,
			Content:    msg.Content,
			CreatedAt:  timestampToString(msg.CreatedAt),
		},
	})

	// Parse @mentions and enqueue tasks for mentioned agents.
	taskID, _ := h.handleChannelMentions(r.Context(), channelID, msg.ID, req.Content, workspaceID)

	// Update last_read_at for the sender.
	h.DB.Exec(r.Context(), `
		UPDATE channel_members SET last_read_at = $4
		WHERE channel_id = $1 AND member_type = 'user' AND member_id = $2
	`, parseUUID(channelID), parseUUID(userID), msg.CreatedAt)

	resp := SendChannelMessageResponse{MessageID: uuidToString(msg.ID)}
	if taskID != "" {
		resp.TaskID = taskID
	}
	writeJSON(w, http.StatusCreated, resp)
}

// handleChannelMentions parses @agent mentions in message content and enqueues tasks.
func (h *Handler) handleChannelMentions(ctx context.Context, channelID string, messageID pgtype.UUID, content json.RawMessage, workspaceID string) (string, error) {
	var contentMap map[string]any
	if err := json.Unmarshal(content, &contentMap); err != nil {
		return "", nil
	}

	mentionedAgents := extractAgentMentions(contentMap)
	if len(mentionedAgents) == 0 {
		return "", nil
	}

	var firstTaskID string
	for _, agentID := range mentionedAgents {
		// Verify agent is a channel member and active.
		var agentMemberExists bool
		h.DB.QueryRow(ctx, `
			SELECT EXISTS(SELECT 1 FROM channel_members WHERE channel_id = $1 AND member_type = 'agent' AND member_id = $2)
		`, parseUUID(channelID), parseUUID(agentID)).Scan(&agentMemberExists)
		if !agentMemberExists {
			continue
		}

		// Get agent runtime.
		var runtimeID pgtype.UUID
		var archivedAt pgtype.Timestamptz
		err := h.DB.QueryRow(ctx, `SELECT runtime_id, archived_at FROM agents WHERE id = $1`, parseUUID(agentID)).Scan(&runtimeID, &archivedAt)
		if err != nil || !runtimeID.Valid || archivedAt.Valid {
			continue
		}

		// Create channel task.
		var taskID string
		err = h.DB.QueryRow(ctx, `
			INSERT INTO agent_task_queue (agent_id, runtime_id, priority, channel_id, trigger_message_id, status)
			VALUES ($1, $2, 2, $3, $4, 'queued')
			RETURNING id::text
		`, parseUUID(agentID), runtimeID, parseUUID(channelID), messageID).Scan(&taskID)
		if err != nil {
			slog.Warn("failed to enqueue channel task", "agent_id", agentID, "error", err)
			continue
		}

		if firstTaskID == "" {
			firstTaskID = taskID
		}

		h.publish(protocol.EventTaskDispatch, workspaceID, "system", "", map[string]any{
			"task_id":    taskID,
			"runtime_id": uuidToString(runtimeID),
			"channel_id": channelID,
		})
	}

	return firstTaskID, nil
}

// extractAgentMentions walks a Tiptap JSON tree and returns unique agent IDs from @mention nodes.
func extractAgentMentions(node any) []string {
	var result []string
	var walk func(n any)
	walk = func(n any) {
		switch v := n.(type) {
		case map[string]any:
			if v["type"] == "mention" {
				if attrs, ok := v["attrs"].(map[string]any); ok {
					if id, ok := attrs["id"].(string); ok && strings.HasPrefix(id, "agent:") {
						result = append(result, strings.TrimPrefix(id, "agent:"))
					}
				}
			}
			for _, val := range v {
				walk(val)
			}
		case []any:
			for _, item := range v {
				walk(item)
			}
		}
	}
	walk(node)
	// Deduplicate.
	seen := map[string]bool{}
	unique := []string{}
	for _, id := range result {
		if !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	return unique
}

// ---------------------------------------------------------------------------
// DM shortcut
// ---------------------------------------------------------------------------

type CreateOrGetDMRequest struct {
	MemberID string `json:"member_id"` // the other member/agent ID
}

func (h *Handler) CreateOrGetDM(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())

	var req CreateOrGetDMRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.MemberID == "" {
		writeError(w, http.StatusBadRequest, "member_id is required")
		return
	}

	// Find existing DM channel between these two users.
	rows, err := h.DB.Query(r.Context(), `
		SELECT c.id, c.workspace_id, c.name, c.type, c.topic, c.created_by, c.last_message_at, c.created_at, c.updated_at
		FROM channels c
		WHERE c.workspace_id = $1 AND c.type = 'dm'
	`, parseUUID(workspaceID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to search DM channels")
		return
	}
	defer rows.Close()

	for rows.Next() {
		var ch db.Channel
		if err := rows.Scan(&ch.ID, &ch.WorkspaceID, &ch.Name, &ch.Type, &ch.Topic, &ch.CreatedBy, &ch.LastMessageAt, &ch.CreatedAt, &ch.UpdatedAt); err != nil {
			continue
		}

		memberRows, err := h.DB.Query(r.Context(), `
			SELECT member_id FROM channel_members WHERE channel_id = $1
		`, ch.ID)
		if err != nil {
			continue
		}
		var memberIDs []string
		for memberRows.Next() {
			var mid string
			if memberRows.Scan(&mid) == nil {
				memberIDs = append(memberIDs, mid)
			}
		}
		memberRows.Close()

		if len(memberIDs) == 2 {
			hasUser := false
			hasOther := false
			for _, mid := range memberIDs {
				if mid == userID {
					hasUser = true
				}
				if mid == req.MemberID {
					hasOther = true
				}
			}
			if hasUser && hasOther {
				writeJSON(w, http.StatusOK, channelToResponse(ch))
				return
			}
		}
	}

	// Create new DM.
	var channel db.Channel
	err = h.DB.QueryRow(r.Context(), `
		INSERT INTO channels (workspace_id, name, type, created_by)
		VALUES ($1, 'dm', 'dm', $2)
		RETURNING id, workspace_id, name, type, topic, created_by, last_message_at, created_at, updated_at
	`, parseUUID(workspaceID), parseUUID(userID)).Scan(
		&channel.ID, &channel.WorkspaceID, &channel.Name, &channel.Type, &channel.Topic,
		&channel.CreatedBy, &channel.LastMessageAt, &channel.CreatedAt, &channel.UpdatedAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create DM channel")
		return
	}

	// Add both members.
	for _, mid := range []string{userID, req.MemberID} {
		h.DB.Exec(r.Context(), `
			INSERT INTO channel_members (channel_id, member_type, member_id, role)
			VALUES ($1, 'user', $2, 'member')
		`, channel.ID, parseUUID(mid))
	}

	h.publish(protocol.EventChannelCreated, workspaceID, "member", userID, map[string]any{
		"channel": channelToResponse(channel),
	})
	writeJSON(w, http.StatusCreated, channelToResponse(channel))
}

// ---------------------------------------------------------------------------
// Issue linking
// ---------------------------------------------------------------------------

type LinkChannelIssueRequest struct {
	IssueID string `json:"issue_id"`
}

func (h *Handler) LinkChannelIssue(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	channelID := chi.URLParam(r, "channelId")

	var req LinkChannelIssueRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	_, err := h.DB.Exec(r.Context(), `
		INSERT INTO channel_issues (channel_id, issue_id, linked_by)
		VALUES ($1, $2, $3)
	`, parseUUID(channelID), parseUUID(req.IssueID), parseUUID(userID))
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "issue already linked")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to link issue")
		return
	}

	w.WriteHeader(http.StatusCreated)
}

func (h *Handler) ListChannelIssues(w http.ResponseWriter, r *http.Request) {
	channelID := chi.URLParam(r, "channelId")

	rows, err := h.DB.Query(r.Context(), `
		SELECT issue_id FROM channel_issues WHERE channel_id = $1
	`, parseUUID(channelID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list linked issues")
		return
	}
	defer rows.Close()

	var issueIDs []string
	for rows.Next() {
		var id pgtype.UUID
		if rows.Scan(&id) == nil {
			issueIDs = append(issueIDs, uuidToString(id))
		}
	}
	writeJSON(w, http.StatusOK, issueIDs)
}

// ---------------------------------------------------------------------------
// Response types & helpers
// ---------------------------------------------------------------------------

type ChannelResponse struct {
	ID            string  `json:"id"`
	WorkspaceID   string  `json:"workspace_id"`
	Name          string  `json:"name"`
	Type          string  `json:"type"`
	Topic         string  `json:"topic"`
	CreatedBy     string  `json:"created_by"`
	LastMessageAt *string `json:"last_message_at"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
	UnreadCount   int     `json:"unread_count,omitempty"`
}

type ChannelMemberResponse struct {
	ID         string  `json:"id"`
	ChannelID  string  `json:"channel_id"`
	MemberType string  `json:"member_type"`
	MemberID   string  `json:"member_id"`
	Role       string  `json:"role"`
	LastReadAt *string `json:"last_read_at"`
	JoinedAt   string  `json:"joined_at"`
}

type MessageResponse struct {
	ID         string          `json:"id"`
	ChannelID  string          `json:"channel_id"`
	AuthorType string          `json:"author_type"`
	AuthorID   string          `json:"author_id"`
	Content    json.RawMessage `json:"content"`
	CreatedAt  string          `json:"created_at"`
	EditedAt   *string         `json:"edited_at"`
}

func channelToResponse(ch db.Channel) ChannelResponse {
	topic := ""
	if ch.Topic.Valid {
		topic = ch.Topic.String
	}
	return ChannelResponse{
		ID:            uuidToString(ch.ID),
		WorkspaceID:   uuidToString(ch.WorkspaceID),
		Name:          ch.Name,
		Type:          ch.Type,
		Topic:         topic,
		CreatedBy:     uuidToString(ch.CreatedBy),
		LastMessageAt: timestampToPtr(ch.LastMessageAt),
		CreatedAt:     timestampToString(ch.CreatedAt),
		UpdatedAt:     timestampToString(ch.UpdatedAt),
	}
}

func channelMemberToResponse(m db.ChannelMember) ChannelMemberResponse {
	return ChannelMemberResponse{
		ID:         uuidToString(m.ID),
		ChannelID:  uuidToString(m.ChannelID),
		MemberType: m.MemberType,
		MemberID:   uuidToString(m.MemberID),
		Role:       m.Role,
		LastReadAt: timestampToPtr(m.LastReadAt),
		JoinedAt:   timestampToString(m.JoinedAt),
	}
}

func messageToResponse(m db.Message) MessageResponse {
	return MessageResponse{
		ID:         uuidToString(m.ID),
		ChannelID:  uuidToString(m.ChannelID),
		AuthorType: m.AuthorType,
		AuthorID:   uuidToString(m.AuthorID),
		Content:    m.Content,
		CreatedAt:  timestampToString(m.CreatedAt),
		EditedAt:   timestampToPtr(m.EditedAt),
	}
}
