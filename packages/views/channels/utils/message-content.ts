/**
 * Convert Tiptap/ProseMirror JSON content to a plain text string for display.
 * Handles simple cases: paragraphs with text, mentions, etc.
 */
export function tiptapJsonToPlainText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!content || typeof content !== "object") return "";

  try {
    const node = content as {
      type?: string;
      content?: unknown[];
      text?: string;
      attrs?: Record<string, unknown>;
      marks?: unknown[];
    };

    if (node.type === "text" && typeof node.text === "string") {
      return node.text;
    }

    if (node.type === "mention" && node.attrs) {
      const label =
        (node.attrs.label as string) || (node.attrs.id as string) || "";
      return `@${label}`;
    }

    if (node.type === "hardBreak") {
      return "\n";
    }

    if (Array.isArray(node.content)) {
      return node.content
        .map((child) => tiptapJsonToPlainText(child))
        .join("");
    }

    // For doc, paragraph, etc - just recurse into content
    if (node.content) {
      return tiptapJsonToPlainText({ content: node.content });
    }

    return "";
  } catch {
    return typeof content === "string" ? content : JSON.stringify(content);
  }
}
