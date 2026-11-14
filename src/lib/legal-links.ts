/**
 * Where the Privacy and Terms pages live and what their links say (spec 0015 AC-2). Every link
 * to them (footer, sign in notice, upload note, user menu) takes the route and label from here,
 * so a rename is one change. Pure: no imports from the app or server layers.
 */
export const LEGAL_LINKS = {
  privacy: { href: "/privacy", label: "Privacy Policy" },
  terms: { href: "/terms", label: "Terms" },
} as const;
