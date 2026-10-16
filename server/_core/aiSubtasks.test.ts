import { afterEach, describe, expect, it, vi } from "vitest";
import { generateAiSubtaskQuestions, generateAiSubtasks, parseAiSubtaskQuestions, parseAiSubtaskSuggestions } from "./aiSubtasks";

const originalApiKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalApiKey;
});

describe("AI subtask question workflow", () => {
  it("requires exactly three usable questions", () => {
    expect(parseAiSubtaskQuestions({ questions: [{ question: "成果物は何ですか？" }, { question: "確認先は誰ですか？" }, { question: "対象範囲はどこまでですか？" }] })).toHaveLength(3);
    expect(() => parseAiSubtaskQuestions({ questions: [{ question: "成果物は何ですか？" }] })).toThrow("必要な質問");
  });

  it("normalizes, deduplicates, and limits suggested subtasks", () => {
    const suggestions = parseAiSubtaskSuggestions({
      subtasks: [
        { text: "  必要書類を一覧化する  " },
        { text: "必要書類を一覧化する" },
        { text: "関係者へ確認を依頼する" },
        { text: "" },
      ],
    });
    expect(suggestions).toEqual([{ text: "必要書類を一覧化する" }, { text: "関係者へ確認を依頼する" }]);
  });

  it("requests structured questions from Gemini", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ questions: [{ question: "完成の判断基準は何ですか？" }, { question: "対象範囲はどこまでですか？" }, { question: "確認が必要な相手は誰ですか？" }] }) }] } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateAiSubtaskQuestions({ title: "指定申請を進める" })).resolves.toHaveLength(3);
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema.required).toEqual(["questions"]);
  });

  it("requires answers before generating subtasks", async () => {
    await expect(generateAiSubtasks({ title: "指定申請を進める", answers: ["提出物", "対象範囲"] })).rejects.toThrow("すべてに回答");
  });

  it("returns safe subtasks after answers are supplied", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ subtasks: [{ text: "提出先を確認する" }, { text: "書類を作成する" }] }) }] } }],
    }), { status: 200 })));

    await expect(generateAiSubtasks({ title: "指定申請を進める", answers: ["申請書一式", "法人変更分のみ", "行政窓口と社内担当者"] })).resolves.toEqual([
      { text: "提出先を確認する" },
      { text: "書類を作成する" },
    ]);
  });
});
