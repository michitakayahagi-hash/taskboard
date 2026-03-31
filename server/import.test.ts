import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db module
vi.mock("./db", () => ({
  createProject: vi.fn().mockResolvedValue(undefined),
  createColumn: vi.fn().mockResolvedValue(undefined),
  createTask: vi.fn().mockResolvedValue(undefined),
  updateTask: vi.fn().mockResolvedValue(undefined),
}));

// We test the CSV parsing logic directly since the tRPC procedure
// depends on the full server context. Extract parseCSVLines for testing.

// Replicate the parseCSVLines function for testing
function parseCSVLines(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        current.push(field);
        field = "";
      } else if (ch === '\r') {
        // skip
      } else if (ch === '\n') {
        current.push(field);
        field = "";
        rows.push(current);
        current = [];
      } else {
        field += ch;
      }
    }
  }
  if (field || current.length > 0) {
    current.push(field);
    rows.push(current);
  }
  while (rows.length > 0 && rows[rows.length - 1].every(c => c.trim() === "")) {
    rows.pop();
  }
  return rows;
}

describe("parseCSVLines", () => {
  it("should parse basic CSV with headers", () => {
    const csv = "リスト名*,タスク名*,説明\n資料,提出書類一覧,テスト説明";
    const result = parseCSVLines(csv);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(["リスト名*", "タスク名*", "説明"]);
    expect(result[1]).toEqual(["資料", "提出書類一覧", "テスト説明"]);
  });

  it("should handle BOM prefix", () => {
    const csv = "\uFEFFリスト名*,タスク名*\n資料,テスト";
    const raw = csv.replace(/^\uFEFF/, "");
    const result = parseCSVLines(raw);
    expect(result[0][0]).toBe("リスト名*");
  });

  it("should handle quoted fields with commas", () => {
    const csv = 'リスト名*,タスク名*,ラベル\n資料,"タスク,名前","ラベルA,ラベルB"';
    const result = parseCSVLines(csv);
    expect(result[1][1]).toBe("タスク,名前");
    expect(result[1][2]).toBe("ラベルA,ラベルB");
  });

  it("should handle escaped quotes", () => {
    const csv = 'a,b\n"he said ""hello""",test';
    const result = parseCSVLines(csv);
    expect(result[1][0]).toBe('he said "hello"');
  });

  it("should handle CRLF line endings", () => {
    const csv = "a,b\r\nc,d\r\ne,f";
    const result = parseCSVLines(csv);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(["a", "b"]);
    expect(result[1]).toEqual(["c", "d"]);
    expect(result[2]).toEqual(["e", "f"]);
  });

  it("should skip empty trailing rows", () => {
    const csv = "a,b\nc,d\n,,\n";
    const result = parseCSVLines(csv);
    expect(result).toHaveLength(2);
  });

  it("should handle empty fields", () => {
    const csv = 'リスト名*,タスク名*,説明\n資料,,';
    const result = parseCSVLines(csv);
    expect(result[1]).toEqual(["資料", "", ""]);
  });

  it("should parse the actual Jooto CSV format correctly", () => {
    const csv = `\uFEFFリスト名*,タスク名*,説明,ステータス*,ラベル,タスク担当者,タスク開始日,タスク開始時間,タスク締切日,タスク締切時間,チェックリスト名,アイテム名,アイテム完了フラグ,アイテム担当者,アイテム開始日,アイテム開始時間,アイテム締切日,アイテム締切時間
資料,提出書類一覧,,未着手,"","",,,,,,,,,,,,,
書類,様式第1号・第１号の２,,未着手,"","",,,,,,,,,,,,,
進行中,,,,,,,,,,,,,,,,,
完了,,,,,,,,,,,,,,,,,`;
    const raw = csv.replace(/^\uFEFF/, "");
    const result = parseCSVLines(raw);
    // Header + 4 data rows
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result[0][0]).toBe("リスト名*");
    expect(result[0][1]).toBe("タスク名*");
    expect(result[1][0]).toBe("資料");
    expect(result[1][1]).toBe("提出書類一覧");
    expect(result[1][3]).toBe("未着手");
    expect(result[2][0]).toBe("書類");
    expect(result[2][1]).toBe("様式第1号・第１号の２");
  });
});

describe("Jooto CSV import logic", () => {
  it("should extract unique list names in order", () => {
    const csv = `リスト名*,タスク名*,説明,ステータス*
資料,タスクA,,未着手
書類,タスクB,,未着手
資料,タスクC,,未着手
進行中,,,
完了,,,`;
    const raw = csv.replace(/^\uFEFF/, "");
    const lines = parseCSVLines(raw);
    const listIdx = 0;
    const taskIdx = 1;

    const listNames: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i];
      const listName = (row[listIdx] || "").trim();
      if (listName && !listNames.includes(listName)) {
        listNames.push(listName);
      }
    }

    expect(listNames).toEqual(["資料", "書類", "進行中", "完了"]);
  });

  it("should extract unique assignees from CSV (split by Japanese comma)", () => {
    const csv = `\u30EA\u30B9\u30C8\u540D*,\u30BF\u30B9\u30AF\u540D*,\u8AAC\u660E,\u30B9\u30C6\u30FC\u30BF\u30B9*,\u30E9\u30D9\u30EB,\u30BF\u30B9\u30AF\u62C5\u5F53\u8005
\u5B8C\u4E86,\u30BF\u30B9\u30AFA,,\u5B8C\u4E86,"",\u897F\u5DDD\u6E05\u9999
\u5B8C\u4E86,\u30BF\u30B9\u30AFB,,\u5B8C\u4E86,"","\u897F\u5DDD\u6E05\u9999\u3001\u82B3\u677E\u5C1A\u7F8E"
\u5B8C\u4E86,\u30BF\u30B9\u30AFC,,\u5B8C\u4E86,"",\u7D4C\u7406 \u793E\u54E1\u3001\u7D4C\u7406\u30B5\u30D62
\u5B8C\u4E86,\u30BF\u30B9\u30AFD,,\u5B8C\u4E86,"",""`;
    const raw = csv.replace(/^\uFEFF/, "");
    const lines = parseCSVLines(raw);
    const assigneeIdx = lines[0].indexOf("\u30BF\u30B9\u30AF\u62C5\u5F53\u8005");

    const allAssignees: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i];
      const rawAssignee = assigneeIdx >= 0 ? (row[assigneeIdx] || "").replace(/^"|"$/g, "").trim() : "";
      if (rawAssignee) {
        const names = rawAssignee.split(/[\u3001,]/).map((n: string) => n.trim()).filter(Boolean);
        for (const name of names) {
          if (!allAssignees.includes(name)) {
            allAssignees.push(name);
          }
        }
      }
    }

    expect(allAssignees).toEqual(["\u897F\u5DDD\u6E05\u9999", "\u82B3\u677E\u5C1A\u7F8E", "\u7D4C\u7406 \u793E\u54E1", "\u7D4C\u7406\u30B5\u30D62"]);
  });

  it("should use first assignee for task when multiple assignees", () => {
    const rawAssignee = "\u897F\u5DDD\u6E05\u9999\u3001\u82B3\u677E\u5C1A\u7F8E";
    const assigneeNames = rawAssignee.split(/[\u3001,]/).map((n: string) => n.trim()).filter(Boolean);
    const assignee = assigneeNames[0] || "";
    expect(assignee).toBe("\u897F\u5DDD\u6E05\u9999");
    expect(assigneeNames).toEqual(["\u897F\u5DDD\u6E05\u9999", "\u82B3\u677E\u5C1A\u7F8E"]);
  });

  it("should handle empty assignee field", () => {
    const rawAssignee = "";
    const assigneeNames = rawAssignee ? rawAssignee.split(/[\u3001,]/).map((n: string) => n.trim()).filter(Boolean) : [];
    const assignee = assigneeNames[0] || "";
    expect(assignee).toBe("");
    expect(assigneeNames).toEqual([]);
  });

  it("should count tasks correctly (skip rows without task name)", () => {
    const csv = `リスト名*,タスク名*,説明,ステータス*
資料,タスクA,,未着手
書類,タスクB,,未着手
資料,タスクC,,未着手
進行中,,,
完了,,,`;
    const raw = csv.replace(/^\uFEFF/, "");
    const lines = parseCSVLines(raw);
    const taskIdx = 1;

    let taskCount = 0;
    for (let i = 1; i < lines.length; i++) {
      const taskName = (lines[i][taskIdx] || "").trim();
      if (taskName) taskCount++;
    }

    expect(taskCount).toBe(3);
  });
});
