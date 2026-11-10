import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FAILURE_CODE_VALUES } from "@/lib/failure-codes";

/**
 * Checks the committed migrations (spec 0002, AC-1, AC-4, AC-10). drizzle-kit has dropped
 * partial index WHERE clauses before, so the generated SQL is asserted, not just the schema.
 * CI's drift check keeps these files in step with the schema.
 */
const dir = fileURLToPath(new URL("../../../drizzle/", import.meta.url));
const migrations = readdirSync(dir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(`${dir}${file}`, "utf8"));
const sql = migrations.join("\n");

/** The full statement that creates `name`, from CREATE to its terminating semicolon. */
function statement(name: string): string {
  const match = sql.match(new RegExp(`CREATE [^;]*"${name}"[^;]*;`));
  expect(match, `statement for ${name}`).not.toBeNull();
  return match?.[0] ?? "";
}

describe("slice 1 migration", () => {
  it("creates every slice 1 table", () => {
    for (const table of [
      "take",
      "processing_job",
      "job_step",
      "cut",
      "render",
      "storage_deletion",
    ]) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it("keeps at most one active job per take with a partial unique index (AC-4)", () => {
    const index = statement("processing_job_one_active_per_take_uidx");
    expect(index).toMatch(/^CREATE UNIQUE INDEX/);
    expect(index).toContain(`ON "processing_job" USING btree ("take_id")`);
    expect(index).toContain(`WHERE "processing_job"."status" IN ('queued', 'running')`);
  });

  it("keeps at most one latest render per take with a partial unique index (AC-10)", () => {
    const index = statement("render_one_latest_per_take_uidx");
    expect(index).toMatch(/^CREATE UNIQUE INDEX/);
    expect(index).toContain(`ON "render" USING btree ("take_id")`);
    expect(index).toContain(`WHERE "render"."is_latest"`);
  });

  it("checks each failure_code column against the full registry", () => {
    const list = FAILURE_CODE_VALUES.map((code) => `'${code}'`).join(", ");
    for (const table of ["take", "processing_job", "job_step"]) {
      expect(sql).toContain(`"${table}"."failure_code" IN (${list})`);
    }
  });

  it("has the spec's range and length checks", () => {
    expect(sql).toContain(`CHECK ("cut"."start_ms" >= 0 AND "cut"."end_ms" > "cut"."start_ms")`);
    expect(sql).toContain(`CHECK ("job_step"."progress" BETWEEN 0 AND 100)`);
    expect(sql).toContain(`CHECK (char_length("take"."title") BETWEEN 1 AND 200)`);
    expect(sql).toContain(`CHECK (char_length("cut"."reason") <= 280)`);
    expect(sql).toContain(`CHECK ("processing_job"."seconds_charged" >= 0)`);
  });

  it("cascades product rows from their owner", () => {
    for (const fk of [
      `"take" ADD CONSTRAINT "take_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade`,
      `"processing_job" ADD CONSTRAINT "processing_job_take_id_take_id_fk" FOREIGN KEY ("take_id") REFERENCES "public"."take"("id") ON DELETE cascade`,
      `"job_step" ADD CONSTRAINT "job_step_job_id_processing_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."processing_job"("id") ON DELETE cascade`,
      `"cut" ADD CONSTRAINT "cut_take_id_take_id_fk" FOREIGN KEY ("take_id") REFERENCES "public"."take"("id") ON DELETE cascade`,
      `"render" ADD CONSTRAINT "render_take_id_take_id_fk" FOREIGN KEY ("take_id") REFERENCES "public"."take"("id") ON DELETE cascade`,
      `"render" ADD CONSTRAINT "render_job_id_processing_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."processing_job"("id") ON DELETE cascade`,
    ]) {
      expect(sql).toContain(fk);
    }
    expect(statement("storage_deletion")).not.toContain("REFERENCES");
  });
});
