const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";
const QUESTION_COUNT = 3;
const MAX_SUBTASKS = 12;
const MAX_SUBTASK_LENGTH = 240;
const MAX_QUESTION_LENGTH = 180;

export type AiSubtaskSuggestionInput = {
  title: string;
  description?: string | null;
  assignee?: string | null;
  answers?: string[];
};

export type AiSubtaskQuestion = {
  question: string;
};

export type AiSubtaskSuggestion = {
  text: string;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
};

type JsonSchema = Record<string, unknown>;

function normalizeText(value: unknown, maxLength = MAX_SUBTASK_LENGTH): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function taskContext(input: AiSubtaskSuggestionInput): string {
  const title = normalizeText(input.title, 200);
  const description = normalizeText(input.description, 4000);
  const assignee = normalizeText(input.assignee, 200);
  if (!title) throw new Error("タスク名を入力してください。");
  return [
    `親タスク: ${title}`,
    description ? `概要: ${description}` : "概要: （未入力）",
    assignee ? `担当者: ${assignee}` : "担当者: （未選択）",
  ].join("\n");
}

async function requestGeminiJson(systemInstruction: string, prompt: string, responseSchema: JsonSchema): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("AI小タスク提案は現在利用できません。管理者へお問い合わせください。");
  }

  let response: Response;
  try {
    response = await fetch(`${GEMINI_API_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
          responseSchema,
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    console.error("[AiSubtasks] Gemini request failed", error);
    throw new Error("AI小タスク提案に接続できませんでした。しばらくしてから再度お試しください。");
  }

  if (!response.ok) {
    console.error("[AiSubtasks] Gemini response failed", { status: response.status });
    throw new Error("AI小タスク提案の生成に失敗しました。しばらくしてから再度お試しください。");
  }

  try {
    const payload = await response.json() as GeminiResponse;
    const rawText = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
    return JSON.parse(rawText);
  } catch (error) {
    console.error("[AiSubtasks] Gemini response parsing failed", error);
    throw new Error("AI小タスク提案の形式を確認できませんでした。しばらくしてから再度お試しください。");
  }
}

export function parseAiSubtaskQuestions(value: unknown): AiSubtaskQuestion[] {
  const source = value && typeof value === "object" && Array.isArray((value as { questions?: unknown }).questions)
    ? (value as { questions: unknown[] }).questions
    : [];
  const seen = new Set<string>();
  const questions: AiSubtaskQuestion[] = [];

  for (const item of source) {
    const question = normalizeText(typeof item === "string" ? item : (item as { question?: unknown })?.question, MAX_QUESTION_LENGTH);
    const key = question.toLocaleLowerCase("ja-JP");
    if (!question || seen.has(key)) continue;
    seen.add(key);
    questions.push({ question });
    if (questions.length >= QUESTION_COUNT) break;
  }

  if (questions.length !== QUESTION_COUNT) {
    throw new Error("AIから必要な質問を取得できませんでした。もう一度お試しください。");
  }
  return questions;
}

export function parseAiSubtaskSuggestions(value: unknown): AiSubtaskSuggestion[] {
  const source = value && typeof value === "object" && Array.isArray((value as { subtasks?: unknown }).subtasks)
    ? (value as { subtasks: unknown[] }).subtasks
    : [];
  const seen = new Set<string>();
  const subtasks: AiSubtaskSuggestion[] = [];

  for (const item of source) {
    const text = normalizeText(typeof item === "string" ? item : (item as { text?: unknown })?.text);
    const key = text.toLocaleLowerCase("ja-JP");
    if (!text || seen.has(key)) continue;
    seen.add(key);
    subtasks.push({ text });
    if (subtasks.length >= MAX_SUBTASKS) break;
  }

  if (subtasks.length === 0) {
    throw new Error("AIから有効な小タスク案を取得できませんでした。内容を補足してもう一度お試しください。");
  }
  return subtasks;
}

const QUESTION_SCHEMA: JsonSchema = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { question: { type: "STRING", description: "利用者が回答する短い確認質問" } },
        required: ["question"],
      },
    },
  },
  required: ["questions"],
};

const SUBTASK_SCHEMA: JsonSchema = {
  type: "OBJECT",
  properties: {
    subtasks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { text: { type: "STRING", description: "実行可能な小タスクの本文" } },
        required: ["text"],
      },
    },
  },
  required: ["subtasks"],
};

export async function generateAiSubtaskQuestions(input: AiSubtaskSuggestionInput): Promise<AiSubtaskQuestion[]> {
  const result = await requestGeminiJson(
    "あなたは業務タスクを小タスクへ分解する前のヒアリング担当です。親タスクの達成に必要な情報を引き出すため、利用者が短く回答できる質問を必ず3つだけ日本語で作成してください。成果物・対象範囲・確認/関係者など、タスクに応じて重要な観点を選んでください。期限や担当を推測して質問に含めないでください。出力は指定JSONだけにしてください。",
    taskContext(input),
    QUESTION_SCHEMA,
  );
  return parseAiSubtaskQuestions(result);
}

export async function generateAiSubtasks(input: AiSubtaskSuggestionInput): Promise<AiSubtaskSuggestion[]> {
  const answers = (input.answers || []).map((answer) => normalizeText(answer, 800)).filter(Boolean);
  if (answers.length < QUESTION_COUNT) {
    throw new Error("AIの質問すべてに回答してください。");
  }

  const result = await requestGeminiJson(
    "あなたは業務タスクを実行可能な小タスクへ分解するアシスタントです。親タスクと利用者の回答だけを根拠に、日本語で具体的な行動を5〜8件提案してください。期限・担当者・完了状態は推測して付与しません。小タスクは短く、重複なく、親タスクを繰り返さない表現にしてください。出力は指定JSONだけにしてください。",
    `${taskContext(input)}\n\n利用者の回答:\n${answers.map((answer, index) => `${index + 1}. ${answer}`).join("\n")}`,
    SUBTASK_SCHEMA,
  );
  return parseAiSubtaskSuggestions(result);
}
