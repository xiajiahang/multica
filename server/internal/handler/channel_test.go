package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/multica-ai/multica/server/internal/middleware"
)

func newRequestAsUser(method, path string, body any, userID string) *http.Request {
	req := newRequest(method, path, body)
	req.Header.Set("X-User-ID", userID)
	member, err := testHandler.getWorkspaceMember(req.Context(), userID, testWorkspaceID)
	if err != nil {
		panic(fmt.Sprintf("newRequestAsUser: missing workspace member for %s in %s: %v", userID, testWorkspaceID, err))
	}
	ctx := middleware.SetMemberContext(req.Context(), testWorkspaceID, member)
	return req.WithContext(ctx)
}

func createWorkspaceMember(t *testing.T) (userID string, memberID string) {
	t.Helper()

	suffix := time.Now().UnixNano()
	email := fmt.Sprintf("channel-test-%d@multica.ai", suffix)
	name := fmt.Sprintf("Channel Test %d", suffix)

	if err := testPool.QueryRow(context.Background(), `
		INSERT INTO "user" (name, email)
		VALUES ($1, $2)
		RETURNING id
	`, name, email).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}

	if err := testPool.QueryRow(context.Background(), `
		INSERT INTO member (workspace_id, user_id, role)
		VALUES ($1, $2, 'member')
		RETURNING id
	`, testWorkspaceID, userID).Scan(&memberID); err != nil {
		t.Fatalf("create member: %v", err)
	}

	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM member WHERE id = $1`, memberID)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM "user" WHERE id = $1`, userID)
	})

	return userID, memberID
}

func createChannelForTests(t *testing.T, actorUserID string, payload map[string]any) ChannelResponse {
	t.Helper()

	w := httptest.NewRecorder()
	req := newRequestAsUser("POST", "/api/channels", payload, actorUserID)
	testHandler.CreateChannel(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateChannel: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var channel ChannelResponse
	if err := json.NewDecoder(w.Body).Decode(&channel); err != nil {
		t.Fatalf("decode channel: %v", err)
	}
	return channel
}

func lookupWorkspaceAgent(t *testing.T) string {
	t.Helper()

	var agentID string
	if err := testPool.QueryRow(context.Background(), `
		SELECT id FROM agent WHERE workspace_id = $1 ORDER BY created_at ASC LIMIT 1
	`, testWorkspaceID).Scan(&agentID); err != nil {
		t.Fatalf("lookup agent: %v", err)
	}
	return agentID
}

func TestChannels_ListAndGetRequireMembership(t *testing.T) {
	channel := createChannelForTests(t, testUserID, map[string]any{
		"name": "private-review",
		"type": "private",
	})

	otherUserID, _ := createWorkspaceMember(t)

	w := httptest.NewRecorder()
	req := newRequestAsUser("GET", "/api/channels", nil, otherUserID)
	testHandler.ListChannels(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListChannels: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var channels []ChannelResponse
	if err := json.NewDecoder(w.Body).Decode(&channels); err != nil {
		t.Fatalf("decode channels: %v", err)
	}
	if len(channels) != 0 {
		t.Fatalf("expected no visible channels for non-member, got %d", len(channels))
	}

	w = httptest.NewRecorder()
	req = newRequestAsUser("GET", "/api/channels/"+channel.ID, nil, otherUserID)
	req = withURLParam(req, "channelId", channel.ID)
	testHandler.GetChannel(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("GetChannel: expected 403 for non-member, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateOrGetDM_UsesMemberIdentityAndReusesExistingChannel(t *testing.T) {
	_, otherMemberID := createWorkspaceMember(t)

	w := httptest.NewRecorder()
	req := newRequestAsUser("POST", "/api/channels/dm", map[string]any{
		"other_member_type": "user",
		"other_member_id":   otherMemberID,
	}, testUserID)
	testHandler.CreateOrGetDM(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateOrGetDM: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var first ChannelResponse
	if err := json.NewDecoder(w.Body).Decode(&first); err != nil {
		t.Fatalf("decode first dm: %v", err)
	}

	w = httptest.NewRecorder()
	req = newRequestAsUser("POST", "/api/channels/dm", map[string]any{
		"other_member_type": "user",
		"other_member_id":   otherMemberID,
	}, testUserID)
	testHandler.CreateOrGetDM(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("CreateOrGetDM reuse: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var second ChannelResponse
	if err := json.NewDecoder(w.Body).Decode(&second); err != nil {
		t.Fatalf("decode second dm: %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("expected DM reuse, got %s and %s", first.ID, second.ID)
	}
}

func TestCreateOrGetDM_SupportsAgentTargets(t *testing.T) {
	agentID := lookupWorkspaceAgent(t)

	w := httptest.NewRecorder()
	req := newRequestAsUser("POST", "/api/channels/dm", map[string]any{
		"other_member_type": "agent",
		"other_member_id":   agentID,
	}, testUserID)
	testHandler.CreateOrGetDM(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateOrGetDM agent: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var channel ChannelResponse
	if err := json.NewDecoder(w.Body).Decode(&channel); err != nil {
		t.Fatalf("decode agent dm: %v", err)
	}
	if channel.Type != "dm" {
		t.Fatalf("expected DM channel, got %s", channel.Type)
	}

	var count int
	if err := testPool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM channel_members WHERE channel_id = $1 AND member_type = 'agent' AND member_id = $2
	`, channel.ID, agentID).Scan(&count); err != nil {
		t.Fatalf("verify agent dm membership: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected agent membership in DM, got %d", count)
	}
}

func TestSendChannelMessage_UpdatesReadStateAndEnqueuesMentionedAgent(t *testing.T) {
	channel := createChannelForTests(t, testUserID, map[string]any{
		"name": "agent-room",
		"type": "public",
	})
	agentID := lookupWorkspaceAgent(t)

	if _, err := testPool.Exec(context.Background(), `
		INSERT INTO channel_members (channel_id, member_type, member_id, role)
		VALUES ($1, 'agent', $2, 'member')
		ON CONFLICT (channel_id, member_type, member_id) DO NOTHING
	`, channel.ID, agentID); err != nil {
		t.Fatalf("add agent to channel: %v", err)
	}

	w := httptest.NewRecorder()
	req := newRequestAsUser("POST", "/api/channels/"+channel.ID+"/messages", map[string]any{
		"content": map[string]any{
			"type": "doc",
			"content": []map[string]any{
				{
					"type": "paragraph",
					"content": []map[string]any{
						{"type": "mention", "attrs": map[string]any{"type": "agent", "id": agentID}},
						{"type": "text", "text": " please review this"},
					},
				},
			},
		},
	}, testUserID)
	req = withURLParam(req, "channelId", channel.ID)
	testHandler.SendChannelMessage(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("SendChannelMessage: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp SendChannelMessageResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode message response: %v", err)
	}
	if resp.TaskID == "" {
		t.Fatal("expected mentioned agent to enqueue a task")
	}

	var lastReadAt *time.Time
	if err := testPool.QueryRow(context.Background(), `
		SELECT cm.last_read_at
		FROM channel_members cm
		JOIN member m ON m.id = cm.member_id
		WHERE cm.channel_id = $1 AND cm.member_type = 'user' AND m.user_id = $2
	`, channel.ID, testUserID).Scan(&lastReadAt); err != nil {
		t.Fatalf("load last_read_at: %v", err)
	}
	if lastReadAt == nil || lastReadAt.IsZero() {
		t.Fatal("expected sender last_read_at to be updated")
	}
}
