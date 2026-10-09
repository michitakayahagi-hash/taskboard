import { describe, expect, it } from "vitest";
import {
  formatAssigneeWithGoogleChatMentions,
  getGoogleChatSpaceName,
} from "./googleChatMentions";

describe("Google Chat deadline mentions", () => {
  it("mentions every mapped assignee and keeps unresolved display names readable", () => {
    const emails = new Map([
      ["西川", "sayakanishikawa@b-bloom.jp"],
      ["矢作充隆", "michitakayahagi@b-bloom.jp"],
    ]);

    expect(formatAssigneeWithGoogleChatMentions("西川, 矢作充隆, 未登録", emails)).toBe(
      "<users/sayakanishikawa@b-bloom.jp> & <users/michitakayahagi@b-bloom.jp> & 未登録",
    );
  });

  it("supports Japanese commas and shows a safe fallback for an empty assignee", () => {
    const emails = new Map([["西川", "sayakanishikawa@b-bloom.jp"]]);
    expect(formatAssigneeWithGoogleChatMentions("西川、未登録", emails)).toBe("<users/sayakanishikawa@b-bloom.jp> & 未登録");
    expect(formatAssigneeWithGoogleChatMentions("", emails)).toBe("担当未設定");
  });

  it("extracts only a valid Google Chat space name from a webhook URL", () => {
    expect(getGoogleChatSpaceName("https://chat.googleapis.com/v1/spaces/AAQAqHZzMjI/messages?key=example&token=example")).toBe("spaces/AAQAqHZzMjI");
    expect(getGoogleChatSpaceName("https://example.com/v1/spaces/AAQAqHZzMjI/messages")).toBeNull();
    expect(getGoogleChatSpaceName("not a url")).toBeNull();
  });
});
