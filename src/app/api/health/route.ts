import { runHealthChecks } from "@/server/health";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const report = await runHealthChecks();
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
