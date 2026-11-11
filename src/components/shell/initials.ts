/** Up to two initials for an avatar: from the name, else from the email. */
export function initialsOf(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length >= 2 ? `${words[0]![0]}${words.at(-1)![0]}` : (words[0] ?? email).slice(0, 2);
  return letters.toUpperCase();
}
