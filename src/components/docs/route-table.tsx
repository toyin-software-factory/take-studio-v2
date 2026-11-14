import type { RouteGroup } from "@/lib/api-docs";
import type { ApiRoute } from "@/lib/api-registry";
import { apiSchema } from "@/lib/api-schemas";
import { type FieldRow, describeSchema } from "@/lib/api-schemas/describe";

/** One group of the public routes: method, path and what it does. Real text, no colour only cues. */
export function RouteTable({ group }: Readonly<{ group: RouteGroup }>) {
  return (
    <section aria-labelledby={`g-${group.id}`} className="flex flex-col gap-3">
      <h3 id={`g-${group.id}`} className="text-h4">
        {group.title}
      </h3>
      <ul className="flex flex-col divide-y divide-border border-y border-border">
        {group.routes.map((route) => (
          <li
            key={`${route.method} ${route.path}`}
            className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-4"
          >
            <code className="font-mono text-sm break-all sm:w-[26rem] sm:shrink-0">
              <span className="font-semibold">{route.method}</span> {route.path}
            </code>
            <div className="flex flex-col gap-2">
              <span>{route.summary}</span>
              <RouteShapes route={route} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Fields({ title, rows }: Readonly<{ title: string; rows: readonly FieldRow[] }>) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-sm font-semibold">{title}</h4>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.path} className="text-sm">
            <code className="font-mono break-all">{row.path}</code>{" "}
            <span>
              {row.type}, {row.required ? "required" : "optional"}
              {row.note === "" ? "" : `, ${row.note}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What a route takes and gives back, from the same schemas as `/api/openapi.json`. */
function RouteShapes({ route }: Readonly<{ route: ApiRoute }>) {
  const request = route.request ? apiSchema(route.request) : undefined;
  const response = route.response ? apiSchema(route.response) : undefined;
  const where = route.method === "GET" ? "Query" : "Request body";
  const requestRows = request ? describeSchema(request, "input") : [];
  const responseRows = response ? describeSchema(response, "output") : [];
  const answer = route.noContent
    ? "Answers 204 with no body."
    : route.text
      ? "Answers with a text file (txt, srt or vtt)."
      : null;
  if (requestRows.length === 0 && responseRows.length === 0 && answer === null) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium">Request and response</summary>
      <div className="mt-2 flex flex-col gap-3">
        <Fields title={where} rows={requestRows} />
        <Fields title="Response" rows={responseRows} />
        {answer ? <p>{answer}</p> : null}
      </div>
    </details>
  );
}
