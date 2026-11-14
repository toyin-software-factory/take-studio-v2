import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { type ApiKeyView, KEY_COPY, keyDate, lastUsedText } from "@/lib/api-keys-screen";

/** The creator's keys (spec 0018 AC-12): name, prefix, created, last used, a revoke button. */
export function KeyList({
  keys,
  headingRef,
  onRevoke,
}: {
  readonly keys: readonly ApiKeyView[];
  readonly headingRef: React.RefObject<HTMLHeadingElement | null>;
  readonly onRevoke: (key: ApiKeyView) => void;
}) {
  return (
    <section aria-labelledby="keys-heading" className="grid gap-4">
      <h2
        id="keys-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-h4 outline-hidden focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring"
      >
        Your keys
      </h2>
      {keys.length === 0 ? (
        <p className="flex items-start gap-3 text-small text-ink">
          <Icon icon={KeyRound} size="ui" className="mt-0.5" />
          {KEY_COPY.empty}
        </p>
      ) : (
        <ul className="divide-y divide-hairline border-y border-hairline">
          {keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4">
              <div className="min-w-0 flex-1 basis-60">
                <p className="font-medium break-words">{key.name}</p>
                <p className="font-mono text-small text-ink">{key.prefix}…</p>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 text-small text-ink">
                <div>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd>{keyDate(key.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last used</dt>
                  <dd>{lastUsedText(key.lastUsedAt)}</dd>
                </div>
              </dl>
              <Button
                id={`revoke-${key.id}`}
                variant="secondary"
                size="sm"
                aria-label={`Revoke key ${key.name}`}
                onClick={() => onRevoke(key)}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
