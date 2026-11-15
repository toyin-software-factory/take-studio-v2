import { z } from "zod";

// ----- The answer -----

export const aiEditAnswerSchema = z.object({
  keepPauses: z.array(z.object({ candidate: z.number().int(), reason: z.string() })),
  wordCuts: z.array(
    z.object({
      fromWord: z.number().int(),
      toWord: z.number().int(),
      kind: z.enum(["false_start", "filler"]),
      reason: z.string(),
    }),
  ),
  fixes: z.array(
    z.object({
      index: z.number().int(),
      old: z.string(),
      new: z.string(),
      reason: z.string(),
    }),
  ),
  background: z.object({ id: z.string(), reason: z.string() }).nullable(),
});
export type AiEditAnswer = z.infer<typeof aiEditAnswerSchema>;

const STRING = { type: "string" } as const;
const INTEGER = { type: "integer" } as const;

/** The same shape as JSON Schema, for the structured output format of the request. */
export const AI_EDIT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["keepPauses", "wordCuts", "fixes", "background"],
  properties: {
    keepPauses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidate", "reason"],
        properties: { candidate: INTEGER, reason: STRING },
      },
    },
    wordCuts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fromWord", "toWord", "kind", "reason"],
        properties: {
          fromWord: INTEGER,
          toWord: INTEGER,
          kind: { type: "string", enum: ["false_start", "filler"] },
          reason: STRING,
        },
      },
    },
    fixes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "old", "new", "reason"],
        properties: { index: INTEGER, old: STRING, new: STRING, reason: STRING },
      },
    },
    background: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "reason"],
          properties: { id: STRING, reason: STRING },
        },
        { type: "null" },
      ],
    },
  },
} as const;
