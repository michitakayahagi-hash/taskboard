import { describe, expect, it } from "vitest";
import {
  allowedGoogleDomainLabel,
  getAllowedGoogleDomains,
  getGoogleHostedDomainHint,
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
});
