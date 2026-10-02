import { describe, expect, it } from "vitest";
import {
  allowedGoogleDomainLabel,
  getAllowedGoogleDomains,
  getGoogleHostedDomainHint,
  isAllowedExternalTaskBoardEmail,
  isAllowedTaskBoardEmail,
  isAllowedGoogleWorkspaceEmail,
} from "./googleDomainPolicy";

describe("Google Workspace domain policy", () => {
  const domains = "b-bloom.jp, b-noix.jp";

  it("accepts both configured organization domains and rejects lookalikes", () => {
    expect(isAllowedGoogleWorkspaceEmail("member@b-bloom.jp", domains)).toBe(true);
    expect(isAllowedGoogleWorkspaceEmail("MEMBER@B-NOIX.JP", domains)).toBe(true);
    expect(isAllowedGoogleWorkspaceEmail("member@other.jp", domains)).toBe(false);
    expect(isAllowedGoogleWorkspaceEmail("member@notb-bloom.jp", domains)).toBe(false);
  });

  it("normalizes, de-duplicates, and labels configured domains", () => {
    expect(getAllowedGoogleDomains(" @B-BLOOM.JP, b-noix.jp, b-bloom.jp ")).toEqual(["b-bloom.jp", "b-noix.jp"]);
    expect(allowedGoogleDomainLabel(domains)).toBe("@b-bloom.jp または @b-noix.jp");
  });

  it("uses the OAuth hosted-domain hint only when exactly one domain is allowed", () => {
    expect(getGoogleHostedDomainHint("b-bloom.jp")).toBe("b-bloom.jp");
    expect(getGoogleHostedDomainHint(domains)).toBeNull();
  });

  it("permits only explicitly allowlisted external accounts to sign in", () => {
    const externalEmails = "kisaragi.0205.star@gmail.com";
    expect(isAllowedExternalTaskBoardEmail("kisaragi.0205.star@gmail.com", externalEmails)).toBe(true);
    expect(isAllowedExternalTaskBoardEmail("other@gmail.com", externalEmails)).toBe(false);
    const oldDomains = process.env.GOOGLE_ALLOWED_DOMAIN;
    const oldExternalEmails = process.env.TASKBOARD_ALLOWED_EXTERNAL_EMAILS;
    process.env.GOOGLE_ALLOWED_DOMAIN = domains;
    process.env.TASKBOARD_ALLOWED_EXTERNAL_EMAILS = externalEmails;
    try {
      expect(isAllowedTaskBoardEmail("member@b-bloom.jp")).toBe(true);
      expect(isAllowedTaskBoardEmail("kisaragi.0205.star@gmail.com")).toBe(true);
      expect(isAllowedTaskBoardEmail("other@gmail.com")).toBe(false);
    } finally {
      if (oldDomains === undefined) delete process.env.GOOGLE_ALLOWED_DOMAIN;
      else process.env.GOOGLE_ALLOWED_DOMAIN = oldDomains;
      if (oldExternalEmails === undefined) delete process.env.TASKBOARD_ALLOWED_EXTERNAL_EMAILS;
      else process.env.TASKBOARD_ALLOWED_EXTERNAL_EMAILS = oldExternalEmails;
    }
  });
});
