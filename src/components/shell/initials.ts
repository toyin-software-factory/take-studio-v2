/** The first `count` characters of `text`, by code point (an emoji stays whole). */
const head = (text: string, count: number) => Array.from(text).slice(0, count).join("");

/** Up to two initials for an avatar: from the name, else from the email. */
export function initialsOf(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length >= 2 ? head(words[0]!, 1) + head(words.at(-1)!, 1) : head(words[0] ?? email, 2);
  return letters.toUpperCase();
}
