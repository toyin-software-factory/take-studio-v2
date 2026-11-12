import { Check, X } from "lucide-react";
import { contrastRatio, meetsAA, minimumRatio } from "./contrast";
import { pairHexes, type ColourToken, type ContrastPair } from "./tokens";

const paint = (name: string) => ({ backgroundColor: `var(--${name})` });

/** One colour token: a swatch painted with its CSS variable, its name, value and use. */
function Swatch({ token, onDark }: { readonly token: ColourToken; readonly onDark: boolean }) {
  return (
    <li className="overflow-hidden rounded-md border bg-card shadow-card">
      {/* Translucent tokens are painted over the surface they are used on. */}
      <div className={onDark ? "bg-dark" : "bg-bg"}>
        <div className="h-16 border-b" style={paint(token.name)} />
      </div>
      <div className="p-3">
        <p className="text-small font-medium">--{token.name}</p>
        <p className="mono text-caption text-muted-foreground">{token.value}</p>
        <p className="text-caption text-muted-foreground">{token.use}</p>
      </div>
    </li>
  );
}

/** One contrast pair: a live sample, the computed ratio and pass or fail as icon plus label. */
function PairRow({ pair }: { readonly pair: ContrastPair }) {
  const hexes = pairHexes(pair);
  const ratio = contrastRatio(hexes.fg, hexes.bg);
  const pass = meetsAA(ratio, pair.kind);
  const Icon = pass ? Check : X;
  return (
    <tr className="border-t">
      <td className="py-2 pr-4">
        {pair.kind === "text" ? (
          <span
            className="inline-block rounded-sm border px-2 py-1 font-medium"
            style={{ ...paint(pair.bg), color: `var(--${pair.fg})` }}
            aria-hidden="true"
          >
            Aa
          </span>
        ) : (
          // UI and decorative colours are only for strokes and fills, never text.
          <span
            className="inline-flex h-8 w-10 items-center justify-center rounded-sm border"
            style={paint(pair.bg)}
            aria-hidden="true"
          >
            <span
              className="block h-4 w-6 rounded-sm border-2"
              style={{ borderColor: `var(--${pair.fg})` }}
            />
          </span>
        )}
      </td>
      <td className="py-2 pr-4 text-small">
        --{pair.fg} on --{pair.bg}
      </td>
      <td className="mono py-2 pr-4 text-small">{ratio.toFixed(1)}:1</td>
      <td className="py-2 text-small">
        {pair.kind === "decorative" ? (
          <span className="text-muted-foreground">Decorative, no minimum</span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
            {pass ? "Passes" : "Fails"} AA ({pair.kind}, {minimumRatio[pair.kind]}:1)
          </span>
        )}
      </td>
    </tr>
  );
}

/** A titled set of colour swatches with the contrast pairs that use them. */
export function ColourSection({
  id,
  title,
  colours,
  pairs,
  onDark = false,
}: {
  readonly id: string;
  readonly title: string;
  readonly colours: readonly ColourToken[];
  readonly pairs: readonly ContrastPair[];
  readonly onDark?: boolean;
}) {
  return (
    <section aria-labelledby={id} className="space-y-6">
      <h2 id={id} className="text-h2 font-medium">
        {title}
      </h2>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {colours.map((token) => (
          <Swatch key={token.name} token={token} onDark={onDark} />
        ))}
      </ul>
      {/* Scrolls sideways on phones; focusable so keyboard users can scroll it too. */}
      <div
        className="overflow-x-auto rounded-md border bg-card p-4 shadow-card"
        role="region"
        aria-label={`${title} contrast pairs`}
        tabIndex={0}
      >
        <table className="w-full min-w-lg text-left">
          <caption className="pb-2 text-left text-h3 font-medium">Contrast pairs</caption>
          <thead>
            <tr className="text-small text-muted-foreground">
              <th scope="col" className="pb-2 font-medium">
                Sample
              </th>
              <th scope="col" className="pb-2 font-medium">
                Pair
              </th>
              <th scope="col" className="pb-2 font-medium">
                Ratio
              </th>
              <th scope="col" className="pb-2 font-medium">
                WCAG AA
              </th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((pair) => (
              <PairRow key={`${pair.fg}-${pair.bg}-${pair.kind}`} pair={pair} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
