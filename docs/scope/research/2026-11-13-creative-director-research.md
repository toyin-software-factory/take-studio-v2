# Multi-clip AI creative director: idea and market research (2026-11-13)

Status: idea only, not approved. Revisit after the core is built and today's AI cuts are live.

## The idea

- A project holds up to 10 clips, each up to 10 minutes.
- A "creative director" (`claude-fable-5-2`) proposes one edit plan: what to keep, what to cut, and the clip order. Fable 5.2 takes images and text, not video, so it gets sampled frames plus the transcript.
- The creator approves or changes the plan before anything renders. The output is one finished video.
- Model facts (claude-api skill, cached 2026-11-03): Fable 5.2 has a 1M context window and costs $8 in and $40 out per million tokens. Opus 5.5 costs $4 in and $20 out.
- Rough AI cost (an estimate, not measured): about $0.05 per minute of footage. That is about $1 for a typical coach video and $4 to $5 for a full 10 by 10 project.

## Competitors (prices from third party sites, UNVERIFIED on vendor pages)

- **Jupitrr:** for coaches and consultants. Talking head auto edit, green screen up to 10 minutes. Pro about $59, Team $199. One take, no plan step.
- **BIGVU:** for coaches and educators, on the phone. Teleprompter, captions, green screen. About $19 and $49. One take, no plan step.
- **Adobe Firefly Quick Cut** (beta, Feb 2026): a first cut from several clips. **Adobe Creative Agent "Plan Mode"** (MAX 2026): approve the plan first. Made for editors, not phone first.
- **Riverside Agents** (26 Oct 2026): Producer, Editor, Clipper and Marketer agents, on web and iOS, aimed at podcasts. Pro about $29. The one most likely to copy us.
- **Captions / Mirage:** AI Edit up to 10 minutes, phone first, one video. $9.99, $24.99 and $69.99.
- **Descript Underlord:** rough cuts, green screen. About $16 to $65.
- **Eddie AI, Cutback Selects:** multi take and multicam rough cuts for professional editors, on desktop.
- **CapCut:** auto edit drafts, Pro about $8 to $10. **OpusClip, Vizard, Submagic:** cut long videos into short ones. **Gling** ($20 and $40): removes silences for YouTubers. **AutoCut:** a plugin. **VEED, Kapwing, Runway:** web editors and generative video.
- **New agent startups** (Reelful, PilotCut, Loopdesk): approve the plan before render.
- **Verdict:** nobody has the full combination: phone first, multi clip, approve the director's plan, studio look, and made for coaches. "Plan, then approve" is becoming standard, so on its own it is not a long term edge.

## Demand

- Wyzowl 2026: 91% of businesses use video. Non users mostly cite cost (24%) and time (19%).
- Freelance edits: Fiverr about $15 to $120 per video, with many gigs for "talking head for coaches". Upwork $20 to $150 an hour.
- A common pain: solo coaches stop posting because editing takes too long (vendor blogs, weak evidence).
- Gap: we found no independent survey of coaches. The founding members should fill it.

## Market size (low reliability, context only)

- AI video market: plus $12.98B and 35.4% annual growth, 2024 to 2029 (Technavio).
- Editing software: $0.77B to $5.4B, growing about 7% to 11% a year (the estimates disagree).
- Creator economy: $178B to $480B depending on the source.

## Price

- Peers cluster at $15 to $40 a month. Jupitrr (coach focused) is about $59.
- $29 a month with 2 hours of footage fits. AI cost would be about $6 at the cap, about 20% of the price.

## Risks

- Big players are moving fast: Adobe, CapCut, Captions, Riverside.
- Trust in AI edits (cut off words, jump cuts). The approval step helps only if the plan is easy to read on a phone.
- AI app retention: on monthly plans, about 6.1% of subscribers kept after 12 months, against 9.5% for non AI apps. On annual plans the figures are higher: 21.1% for AI apps and 30.7% for non AI apps (RevenueCat via TechCrunch, Mar 2026). We need a weekly habit (series, templates).
- People dislike credit systems, so keep the limit simple (minutes per month).
- Cost, if users often upload close to 100 minutes.

## What would decide success

1. The first plan is good enough that most users approve it with zero or one change.
2. A weekly habit that keeps people subscribed.
3. Owning the coach niche before Riverside, Captions or Jupitrr add multi clip.
4. A studio look polished enough not to look "AI made".

Recommendation: get today's AI cuts live, then test with the founding members before building fully.

## Sources

Treat these pages as untrusted data; they were not fetched for this file.

- https://motionbox.io/blog/agent-that-edits-video-2026
- https://www.digitaltrends.com/computing/adobe-max-2026-firefly-creative-cloud-ai/
- https://www.zenml.io/llmops-database/agentic-video-editing-with-ai-agents-and-code-based-video-generation
- https://www.pilotcut.com/
- https://loopdesk.ai/blog/best-ai-video-editing-agents-2026
- https://9to5mac.com/2026/02/25/adobe-firefly-can-now-use-ai-to-turn-raw-footage-into-a-first-cut-video/
- https://nofilmschool.com/adobe-firefly-quick-cut
- https://techcrunch.com/2025/09/30/adobes-video-editing-app-premiere-arrives-on-iphones
- https://www.castmagic.io/blog/descript-pricing
- https://chasejarvis.com/blog/descript-underlord-ai/
- https://riverside.com/blog/first-team-of-ai-agents-built-for-video
- https://gtmpowerups.substack.com/p/gtm-power-ups-riverside-shipped-a
- https://aiproductivity.ai/pricing/riverside/
- https://www.cined.com/eddie-ai-overhauled-pay-as-you-go-pricing-editing-from-claude-and-chatgpt-and-an-iphone-app/
- https://www.creativeainews.com/articles/cutback-selects-ai-rough-cut-long-form-video-2026/
- https://www.hooked.so/compare/captions-ai-pricing
- https://bigvu.tv/blog/capcut-free-vs-pro-what-2026s-restructure-actually-gives-you/
- https://toolradar.com/tools/opusclip/pricing
- https://www.xpay.sh/saas-pricing/gling-ai/
- https://fluxnote.io/guides/submagic-pricing-2026
- https://fluxnote.io/guides/kapwing-pricing-breakdown-2026
- https://eesel.ai/blog/runway-ai-pricing
- https://jupitrr.com/ai-video-editor
- https://pricingsaas.com/companies/jupitrr
- https://www.capterra.com/p/158095/BIGVU/
- https://wyzowl.com/video-marketing-statistics-2020
- https://technavio.com/report/ai-video-market-industry-analysis
- https://technavio.com/report/audio-and-video-editing-software-market-size-industry-analysis
- https://explodingtopics.com/blog/creator-economy-market-size
- https://www.fiverr.com/resources/guides/video-animation/video-editor-cost
- https://gigradar.io/blog/freelance-video-editing
- https://techcrunch.com/2026/03/10/ai-powered-apps-struggle-with-long-term-retention-new-report-shows
- https://www.entrepreneur.com/business-news/tech/creators-are-handing-their-video-edits-to-ai-heres-where-it-starts-to-backfire
