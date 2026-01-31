import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getProfileSkillsDir, loadAllSkills, initializeManagedSkills, getManagedSkillsDir } from "./loader.js";

describe("loader", () => {
  const testBaseDir = join(tmpdir(), `multica-skills-test-${Date.now()}`);

  beforeEach(() => {
    if (existsSync(testBaseDir)) {
      rmSync(testBaseDir, { recursive: true });
    }
    mkdirSync(testBaseDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testBaseDir)) {
      rmSync(testBaseDir, { recursive: true });
    }
  });

  describe("getProfileSkillsDir", () => {
    it("should return correct path with custom base dir", () => {
      const result = getProfileSkillsDir("my-profile", testBaseDir);
      expect(result).toBe(join(testBaseDir, "my-profile", "skills"));
    });

    it("should use default base dir when not provided", () => {
      const result = getProfileSkillsDir("my-profile");
      expect(result).toContain(".super-multica");
      expect(result).toContain("agent-profiles");
      expect(result).toContain("my-profile");
      expect(result).toContain("skills");
    });
  });

  describe("getManagedSkillsDir", () => {
    it("should return path to managed skills", () => {
      const result = getManagedSkillsDir();
      expect(result).toContain(".super-multica");
      expect(result).toContain("skills");
    });
  });

  describe("initializeManagedSkills", () => {
    it("should not throw when called", () => {
      expect(() => initializeManagedSkills()).not.toThrow();
    });
  });

  describe("loadAllSkills", () => {
    function createSkillDir(baseDir: string, skillId: string, name: string) {
      const skillDir = join(baseDir, skillId);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: ${name}
description: Test skill ${skillId}
---
Instructions for ${name}
`
      );
    }

    it("should load skills from profile directory", () => {
      const profileDir = join(testBaseDir, "profiles", "test-profile", "skills");
      mkdirSync(profileDir, { recursive: true });
      createSkillDir(profileDir, "profile-skill", "Profile Skill");

      const skills = loadAllSkills({
        profileId: "test-profile",
        profileBaseDir: join(testBaseDir, "profiles"),
      });

      expect(skills.has("profile-skill")).toBe(true);
      const skill = skills.get("profile-skill");
      expect(skill?.frontmatter.name).toBe("Profile Skill");
      expect(skill?.source).toBe("profile");
    });

    it("should return map when no profile provided", () => {
      const skills = loadAllSkills({});
      expect(skills).toBeInstanceOf(Map);
    });

    it("should skip invalid skill files", () => {
      const profileDir = join(testBaseDir, "profiles", "test-profile", "skills");
      mkdirSync(profileDir, { recursive: true });

      // Create valid skill
      createSkillDir(profileDir, "valid-skill", "Valid Skill");

      // Create invalid skill (no name in frontmatter)
      const invalidDir = join(profileDir, "invalid-skill");
      mkdirSync(invalidDir, { recursive: true });
      writeFileSync(
        join(invalidDir, "SKILL.md"),
        `---
description: Missing name field
---
Invalid skill
`
      );

      const skills = loadAllSkills({
        profileId: "test-profile",
        profileBaseDir: join(testBaseDir, "profiles"),
      });

      expect(skills.has("valid-skill")).toBe(true);
      expect(skills.has("invalid-skill")).toBe(false);
    });

    it("should skip directories without SKILL.md", () => {
      const profileDir = join(testBaseDir, "profiles", "test-profile", "skills");
      mkdirSync(profileDir, { recursive: true });

      // Directory without SKILL.md
      const noSkillDir = join(profileDir, "not-a-skill");
      mkdirSync(noSkillDir, { recursive: true });
      writeFileSync(join(noSkillDir, "README.md"), "Just a readme");

      // Valid skill
      createSkillDir(profileDir, "real-skill", "Real Skill");

      const skills = loadAllSkills({
        profileId: "test-profile",
        profileBaseDir: join(testBaseDir, "profiles"),
      });

      expect(skills.has("real-skill")).toBe(true);
      expect(skills.has("not-a-skill")).toBe(false);
    });

    it("should load multiple skills from profile directory", () => {
      const profileDir = join(testBaseDir, "profiles", "test-profile", "skills");
      mkdirSync(profileDir, { recursive: true });

      createSkillDir(profileDir, "skill-a", "Skill A");
      createSkillDir(profileDir, "skill-b", "Skill B");
      createSkillDir(profileDir, "skill-c", "Skill C");

      const skills = loadAllSkills({
        profileId: "test-profile",
        profileBaseDir: join(testBaseDir, "profiles"),
      });

      expect(skills.has("skill-a")).toBe(true);
      expect(skills.has("skill-b")).toBe(true);
      expect(skills.has("skill-c")).toBe(true);
    });
  });
});
