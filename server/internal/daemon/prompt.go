package daemon

import (
	"encoding/json"
	"fmt"
	"strings"
)

// BuildPrompt constructs the task prompt for an agent CLI.
// Keep this minimal — detailed instructions live in CLAUDE.md / AGENTS.md
// injected by execenv.InjectRuntimeConfig.
func BuildPrompt(task Task) string {
	if task.ChatSessionID != "" {
		return buildChatPrompt(task)
	}
	if task.ChannelID != "" {
		return buildChannelPrompt(task)
	}
	var b strings.Builder
	b.WriteString("You are running as a local coding agent for a Multica workspace.\n\n")
	fmt.Fprintf(&b, "Your assigned issue ID is: %s\n\n", task.IssueID)
	fmt.Fprintf(&b, "Start by running `multica issue get %s --output json` to understand your task, then complete it.\n", task.IssueID)
	return b.String()
}

// buildChatPrompt constructs a prompt for interactive chat tasks.
func buildChatPrompt(task Task) string {
	var b strings.Builder
	b.WriteString("You are running as a chat assistant for a Multica workspace.\n")
	b.WriteString("A user is chatting with you directly. Respond to their message.\n\n")
	fmt.Fprintf(&b, "User message:\n%s\n", task.ChatMessage)
	return b.String()
}

// buildChannelPrompt constructs a prompt for channel-based tasks.
func buildChannelPrompt(task Task) string {
	var b strings.Builder
	b.WriteString("You are running as an agent in a Multica channel.\n")
	b.WriteString("A user mentioned you in a channel message. Respond helpfully.\n\n")

	if task.Channel != nil {
		fmt.Fprintf(&b, "Channel: #%s", task.Channel.Name)
		if task.Channel.Topic != "" {
			fmt.Fprintf(&b, " (topic: %s)", task.Channel.Topic)
		}
		b.WriteString("\n\n")
	}

	// Find and include the trigger message content.
	if triggerMsg := findTriggerMessage(task); triggerMsg != "" {
		fmt.Fprintf(&b, "User's message:\n%s\n", triggerMsg)
	}

	b.WriteString("\nRespond directly to the user's message. Be concise and helpful.\n")
	return b.String()
}

// findTriggerMessage locates the trigger message text from channel context.
func findTriggerMessage(task Task) string {
	if task.Channel == nil || task.TriggerMessageID == "" {
		return ""
	}
	for _, msg := range task.Channel.Messages {
		if msg.ID == task.TriggerMessageID {
			return tiptapToText(msg.Content)
		}
	}
	return ""
}

// tiptapToText extracts plain text from a Tiptap JSON content node.
func tiptapToText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var node map[string]any
	if err := json.Unmarshal(raw, &node); err != nil {
		return string(raw)
	}
	return extractText(node)
}

func extractText(n any) string {
	switch v := n.(type) {
	case map[string]any:
		var parts []string
		// If this is a text node, return its text.
		if t, ok := v["text"].(string); ok {
			return t
		}
		// Recurse into content array.
		if content, ok := v["content"].([]any); ok {
			for _, child := range content {
				if t := extractText(child); t != "" {
					parts = append(parts, t)
				}
			}
		}
		return strings.Join(parts, "")
	case []any:
		var parts []string
		for _, item := range v {
			if t := extractText(item); t != "" {
				parts = append(parts, t)
			}
		}
		return strings.Join(parts, " ")
	}
	return ""
}
