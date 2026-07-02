import { describe, it, expect } from "vitest";
import {
  inferFieldType,
  inferSchemaFromData,
  detectNewFields,
  mergeSchema,
  type CollectionSchema,
} from "./schema-inference";

describe("inferFieldType", () => {
  it("detects booleans", () => {
    expect(inferFieldType([true, false, true])).toEqual({ type: "boolean" });
  });

  it("detects numbers", () => {
    expect(inferFieldType([1, 2, 3.5])).toEqual({ type: "number" });
  });

  it("detects bare ISO dates (no time component)", () => {
    expect(inferFieldType(["2026-05-03", "2026-05-10"])).toEqual({ type: "date" });
  });

  it("detects ISO dates with time component", () => {
    expect(inferFieldType(["2026-05-03T10:00:00Z", "2026-05-10T12:30:00Z"])).toEqual({ type: "date" });
  });

  it("detects ISO dates with space separator", () => {
    expect(inferFieldType(["2026-05-03 10:00:00", "2026-05-10 12:30:00"])).toEqual({ type: "date" });
  });

  it("detects URLs", () => {
    expect(inferFieldType(["https://example.com", "http://test.org"])).toEqual({ type: "url" });
  });

  it("detects image URLs", () => {
    expect(inferFieldType(["https://example.com/photo.jpg", "https://test.org/img.png"])).toEqual({
      type: "image_url",
    });
  });

  it("detects emails", () => {
    expect(inferFieldType(["a@b.com", "c@d.org"])).toEqual({ type: "email" });
  });

  it("detects select fields by name hint", () => {
    const result = inferFieldType(["active", "active", "active"], "status");
    expect(result.type).toBe("select");
    expect(result.options).toEqual(["active"]);
  });

  it("detects multiselect (arrays of strings)", () => {
    expect(inferFieldType([["a", "b"], ["c"]])).toEqual({ type: "multiselect" });
  });

  it("returns text for high-cardinality strings", () => {
    const values = Array.from({ length: 20 }, (_, i) => `unique sentence number ${i}`);
    expect(inferFieldType(values)).toEqual({ type: "text" });
  });

  it("returns text for empty values", () => {
    expect(inferFieldType([null, undefined])).toEqual({ type: "text" });
  });

  it("detects json for objects", () => {
    expect(inferFieldType([{ a: 1 }, { b: 2 }])).toEqual({ type: "json" });
  });
});

describe("detectNewFields", () => {
  it("returns true when schema is null", () => {
    expect(detectNewFields(null, { name: "test" })).toBe(true);
  });

  it("returns true when schema has no fields", () => {
    const schema: CollectionSchema = { fields: [], version: 1, lastInferredAt: "" };
    expect(detectNewFields(schema, { name: "test" })).toBe(true);
  });

  it("returns false when all fields are known", () => {
    const schema: CollectionSchema = {
      fields: [
        { name: "name", type: "text", inferred: true, position: 0, hidden: false },
        { name: "age", type: "number", inferred: true, position: 1, hidden: false },
      ],
      version: 1,
      lastInferredAt: "",
    };
    expect(detectNewFields(schema, { name: "Alice", age: 30 })).toBe(false);
  });

  it("returns true when data has a field not in schema", () => {
    const schema: CollectionSchema = {
      fields: [{ name: "name", type: "text", inferred: true, position: 0, hidden: false }],
      version: 1,
      lastInferredAt: "",
    };
    expect(detectNewFields(schema, { name: "Alice", due_date: "2026-05-03" })).toBe(true);
  });
});

describe("inferSchemaFromData", () => {
  it("infers schema from an array of data objects", () => {
    const data = Array.from({ length: 10 }, (_, i) => ({
      name: `Task ${i} with a unique description`,
      due_date: `2026-05-${String(i + 1).padStart(2, "0")}`,
      done: i % 2 === 0,
    }));
    const schema = inferSchemaFromData(data);

    expect(schema.fields).toHaveLength(3);

    const byName = Object.fromEntries(schema.fields.map((f) => [f.name, f]));
    expect(byName.name.type).toBe("text");
    expect(byName.due_date.type).toBe("date");
    expect(byName.done.type).toBe("boolean");
  });

  it("sorts fields by frequency (most common first)", () => {
    const data = [
      { name: "A", rare: 1 },
      { name: "B" },
      { name: "C" },
    ];
    const schema = inferSchemaFromData(data);
    expect(schema.fields[0].name).toBe("name");
  });

  it("handles empty input", () => {
    const schema = inferSchemaFromData([]);
    expect(schema.fields).toEqual([]);
  });

  it("sets all fields as inferred", () => {
    const schema = inferSchemaFromData([{ x: 1 }]);
    expect(schema.fields.every((f) => f.inferred)).toBe(true);
  });
});

describe("mergeSchema", () => {
  it("returns inferred schema when existing is null", () => {
    const inferred: CollectionSchema = {
      fields: [{ name: "name", type: "text", inferred: true, position: 0, hidden: false }],
      version: 1,
      lastInferredAt: "2026-05-01",
    };
    expect(mergeSchema(null, inferred)).toBe(inferred);
  });

  it("returns inferred schema when existing has no fields", () => {
    const existing: CollectionSchema = { fields: [], version: 1, lastInferredAt: "" };
    const inferred: CollectionSchema = {
      fields: [{ name: "name", type: "text", inferred: true, position: 0, hidden: false }],
      version: 1,
      lastInferredAt: "2026-05-01",
    };
    expect(mergeSchema(existing, inferred)).toBe(inferred);
  });

  it("preserves human-set fields and does not override their type", () => {
    const existing: CollectionSchema = {
      fields: [{ name: "status", type: "select", inferred: false, position: 0, hidden: false, options: ["a", "b"] }],
      version: 1,
      lastInferredAt: "",
    };
    const inferred: CollectionSchema = {
      fields: [{ name: "status", type: "text", inferred: true, position: 0, hidden: false }],
      version: 1,
      lastInferredAt: "2026-05-01",
    };
    const merged = mergeSchema(existing, inferred);
    const statusField = merged.fields.find((f) => f.name === "status")!;
    expect(statusField.type).toBe("select");
    expect(statusField.inferred).toBe(false);
    expect(statusField.options).toEqual(["a", "b"]);
  });

  it("updates inferred field types from new inference", () => {
    const existing: CollectionSchema = {
      fields: [{ name: "due", type: "text", inferred: true, position: 0, hidden: false }],
      version: 1,
      lastInferredAt: "",
    };
    const inferred: CollectionSchema = {
      fields: [{ name: "due", type: "date", inferred: true, position: 0, hidden: false }],
      version: 1,
      lastInferredAt: "2026-05-01",
    };
    const merged = mergeSchema(existing, inferred);
    expect(merged.fields.find((f) => f.name === "due")!.type).toBe("date");
  });

  it("adds newly discovered fields after existing ones", () => {
    const existing: CollectionSchema = {
      fields: [{ name: "name", type: "text", inferred: true, position: 0, hidden: false }],
      version: 1,
      lastInferredAt: "",
    };
    const inferred: CollectionSchema = {
      fields: [
        { name: "name", type: "text", inferred: true, position: 0, hidden: false },
        { name: "due_date", type: "date", inferred: true, position: 1, hidden: false },
      ],
      version: 1,
      lastInferredAt: "2026-05-01",
    };
    const merged = mergeSchema(existing, inferred);
    expect(merged.fields).toHaveLength(2);
    expect(merged.fields[1].name).toBe("due_date");
    expect(merged.fields[1].position).toBe(1);
  });

  it("increments version", () => {
    const existing: CollectionSchema = {
      fields: [{ name: "name", type: "text", inferred: true, position: 0, hidden: false }],
      version: 3,
      lastInferredAt: "",
    };
    const inferred: CollectionSchema = {
      fields: [{ name: "name", type: "text", inferred: true, position: 0, hidden: false }],
      version: 1,
      lastInferredAt: "2026-05-01",
    };
    expect(mergeSchema(existing, inferred).version).toBe(4);
  });

  it("retires inferred fields that no record contains anymore", () => {
    const existing: CollectionSchema = {
      fields: [
        { name: "title", type: "text", inferred: true, position: 0, hidden: false },
        { name: "recommendation", type: "text", inferred: true, position: 1, hidden: false },
      ],
      version: 1,
      lastInferredAt: "",
    };
    // After a rename across all records: only "title" and "notes" are present.
    const inferred: CollectionSchema = {
      fields: [
        { name: "title", type: "text", inferred: true, position: 0, hidden: false },
        { name: "notes", type: "text", inferred: true, position: 1, hidden: false },
      ],
      version: 1,
      lastInferredAt: "2026-05-02",
    };
    const merged = mergeSchema(existing, inferred);
    expect(merged.fields.map((f) => f.name)).toEqual(["title", "notes"]);
  });

  it("preserves human-edited fields even when no record contains them anymore", () => {
    const existing: CollectionSchema = {
      fields: [
        { name: "title", type: "text", inferred: true, position: 0, hidden: false },
        { name: "priority", type: "select", inferred: false, position: 1, hidden: false, options: ["high", "low"] },
      ],
      version: 1,
      lastInferredAt: "",
    };
    const inferred: CollectionSchema = {
      fields: [{ name: "title", type: "text", inferred: true, position: 0, hidden: false }],
      version: 1,
      lastInferredAt: "2026-05-02",
    };
    const merged = mergeSchema(existing, inferred);
    expect(merged.fields.find((f) => f.name === "priority")).toBeDefined();
  });

  it("does not retire any fields when the new inference is empty (e.g., zero records)", () => {
    const existing: CollectionSchema = {
      fields: [
        { name: "title", type: "text", inferred: true, position: 0, hidden: false },
        { name: "notes", type: "text", inferred: true, position: 1, hidden: false },
      ],
      version: 1,
      lastInferredAt: "",
    };
    const inferred: CollectionSchema = { fields: [], version: 1, lastInferredAt: "2026-05-02" };
    const merged = mergeSchema(existing, inferred);
    expect(merged.fields.map((f) => f.name)).toEqual(["title", "notes"]);
  });
});
