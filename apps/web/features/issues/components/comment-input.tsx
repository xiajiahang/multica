"use client";

import { useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichTextEditor, type RichTextEditorRef } from "@/components/common/rich-text-editor";

interface CommentInputProps {
  onSubmit: (content: string) => Promise<void>;
}

function CommentInput({ onSubmit }: CommentInputProps) {
  const editorRef = useRef<RichTextEditorRef>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const content = editorRef.current?.getMarkdown()?.trim();
    if (!content || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(content);
      editorRef.current?.clearContent();
      setIsEmpty(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card ring-1 ring-foreground/10">
      <div className="min-h-20 max-h-48 overflow-y-auto px-3 py-2">
        <RichTextEditor
          ref={editorRef}
          placeholder="Leave a comment..."
          onUpdate={(md) => setIsEmpty(!md.trim())}
          onSubmit={handleSubmit}
          debounceMs={100}
        />
      </div>
      <div className="flex items-center justify-end border-t border-border/50 px-2 py-1.5">
        <Button
          size="icon-sm"
          disabled={isEmpty || submitting}
          onClick={handleSubmit}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export { CommentInput };
