import { LEGAL_LINKS } from "@/lib/legal-links";
import { CONTACT_EMAIL } from "@/lib/site";
import { VIDEO_RETENTION_DAYS } from "@/lib/take-rules";
import { gigabytes, minutes, resolution } from "./content-limits";

export const FAQ = {
  eyebrow: "Questions",
  muted: "Before you upload.",
  strong: "The short answers.",
  items: [
    {
      q: "What do I need to film?",
      a: "One take on your phone or camera. Film in front of a green screen if you want a studio background. Without one, you still get the pauses trimmed and a transcript.",
    },
    {
      q: "Which files can I upload?",
      a: `MP4 or MOV, up to ${minutes} minutes long, about ${gigabytes} GB, and up to ${resolution}. We check the file type and size before upload. We check the length and resolution after upload, and a file over either limit fails with a message that names it.`,
    },
    {
      q: "Can I get the untrimmed video?",
      a: `Yes. Download the original next to the trimmed video for as long as it is kept, ${VIDEO_RETENTION_DAYS} days.`,
    },
    {
      q: "Which languages do transcripts support?",
      a: "English for now. Captions download as SRT, timed to the trimmed video, and as plain text.",
    },
    {
      q: "How long do you keep my videos?",
      a: `The original and the finished video are kept for ${VIDEO_RETENTION_DAYS} days and then deleted automatically. Transcripts stay until you delete the take. Deleting a take removes everything.`,
    },
    {
      q: "What does it cost?",
      a: "Nothing while we're in beta. Paid plans may come later, and we'll tell you before anything changes.",
    },
    {
      q: "Can an AI agent use Take Studio?",
      a: "Yes. The public API and the MCP server let an agent upload a take, pick a studio and fetch the captions. Make an API key from your account, or connect Claude.ai by signing in.",
    },
  ],
} as const;

export const CLOSING = {
  eyebrow: "Ready when you are",
  muted: "Your next take,",
  strong: "without the edit.",
  lead: "Take Studio is in beta and free for now. Sign in with Google or an email link and upload your first take.",
  emailLabel: "Email",
  emailPlaceholder: "you@example.com",
  cta: "Email me a sign in link",
  signInNote: "Already have an account?",
  signInLink: "Sign in with Google or an email link",
  invalid: "Enter an email address like you@example.com.",
  sending: "Sending…",
  sentTitle: "Check your inbox.",
  sent: (email: string) =>
    `If ${email} can sign in, a link is on its way. It works once and expires in 15 minutes.`,
  questions: "Questions?",
  email: CONTACT_EMAIL,
} as const;

export const FOOTER = {
  columns: [
    {
      label: "Product",
      links: [
        { href: "#reel", label: "How it works" },
        { href: "#studio", label: "Studios" },
        { href: "#capabilities", label: "Features" },
        { href: "#faq", label: "FAQ" },
      ],
    },
    {
      label: "Account",
      links: [
        { href: "/sign-in", label: "Sign in" },
        { href: "/sign-in", label: "Upload a take" },
      ],
    },
    {
      label: "For agents",
      links: [
        { href: "/docs/api", label: "Public API" },
        { href: "/docs/mcp", label: "MCP server" },
      ],
    },
    {
      label: "Legal",
      links: [
        { href: LEGAL_LINKS.privacy.href, label: "Privacy" },
        { href: LEGAL_LINKS.terms.href, label: "Terms" },
        { href: `mailto:${CONTACT_EMAIL}`, label: CONTACT_EMAIL },
      ],
    },
  ],
  note: `Videos are deleted after ${VIDEO_RETENTION_DAYS} days. Transcripts stay until you delete the take.`,
  year: 2026,
} as const;
