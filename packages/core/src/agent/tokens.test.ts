import { describe, it, expect } from "vitest";
import { isSilentReplyText, SILENT_REPLY_TOKEN } from "./tokens.js";

describe("isSilentReplyText", () => {
  it("detects exact NO_REPLY", () => {
    expect(isSilentReplyText("NO_REPLY")).toBe(true);
  });

  it("detects NO_REPLY with surrounding whitespace", () => {
    expect(isSilentReplyText("  NO_REPLY  ")).toBe(true);
    expect(isSilentReplyText("\nNO_REPLY\n")).toBe(true);
  });

  it("detects NO_REPLY with trailing punctuation", () => {
    expect(isSilentReplyText("NO_REPLY.")).toBe(true);
    expect(isSilentReplyText("NO_REPLY.\n")).toBe(true);
  });

  it("detects NO_REPLY at end of text", () => {
    expect(isSilentReplyText("I have nothing to report. NO_REPLY")).toBe(true);
  });

  it("returns false for undefined/empty", () => {
    expect(isSilentReplyText(undefined)).toBe(false);
    expect(isSilentReplyText("")).toBe(false);
  });

  it("returns false for normal text", () => {
    expect(isSilentReplyText("Here are the findings")).toBe(false);
  });

  it("returns false for NO_REPLY embedded in a word", () => {
    expect(isSilentReplyText("DONO_REPLYX")).toBe(false);
  });

  it("exports SILENT_REPLY_TOKEN as NO_REPLY", () => {
    expect(SILENT_REPLY_TOKEN).toBe("NO_REPLY");
  });
});
