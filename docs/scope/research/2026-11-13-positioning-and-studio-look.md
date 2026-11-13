# Positioning and "studio look" research (2026-11-13)

Saved so we can revisit it after the core product is built. Nothing here is a decision. All figures are estimates from web research on 2026-11-13, mostly from blogs and vendor pages, so read them as directional.

## Demand and competition (2026-11-13 web research; figures are directional, mostly from blogs and vendor pages)

- **Demand.** Editing is the most mentioned creator struggle: 21.4% of the 9,677 actionable comments (out of 27,555 YouTube comments read; overseeros.com). Creators spend about 9 to 15 hours a week on content (Adobe). Paid tools sell "skip editing": Gling about $10 to $20 a month, Descript about $16 to $35 a month, AutoCut $79 a year, Captions from about $10 a month.
- **Crowded areas.**
  - Pause and filler cutting: Gling, Descript, Wisecut, AutoCut, and Clipchamp (free).
  - Background swap without a green screen: CapCut, VEED, Descript "Green Screen", Vmake, Higgsfield. It is fine against a plain wall and wobbly with busy rooms and hair.
  - Transcripts and captions are everywhere.
- **Our possible selling point.** No editing at all. One upload gives a finished video (pauses gone, studio background, transcript) with no timeline. A real studio look, not a blurred room. Phone first, in the browser. The promise to test: "Talk to your phone. Get a studio-quality video back. No editing."
- **First audience.** People who need talking head video but are not editors: coaches, consultants, founders, teachers, course makers, recruiters, estate agents and small businesses. Not YouTubers who already edit.
- **Risks.** Free tools are good enough for many people. Big players can copy us. The AI edit step is off in production until S5A-T08.
- **Next moves we recommend.**
  1. Product analytics (feature 17) first, so we can see what people do.
  2. Put the app in front of 10 to 20 people from one group and watch for a second upload.
  3. Price at about $10 to $15 a month, with a free first video.

## Three features that could make us unique

1. **Real studio look, not a cut out** (recommended first).
2. **Your own branded set**: logo, brand colours and the same framing every time.
3. **Just talk, we keep the best take**: the best attempt at each point is kept automatically.

## Studio look: what top notch needs

Five pieces:

1. **AI cut out, with or without a green screen.** It needs a GPU vendor such as Replicate, fal or Modal. Spec 0008 already lists it as a later upgrade. Videos go to the vendor, so the privacy page must say so.
2. **Match the person to the set's light.** Colour, brightness, contrast, despill and light wrap. This runs on our own Trigger.dev servers.
3. **Ground them in the room.** A contact shadow, depth blur, and matched grain and sharpness.
4. **Smart framing.** Face detection, a natural zoom, and an optional slow push in.
5. **Backgrounds made for compositing.** A known light direction, camera height and floor, and maybe short looping videos.

**Proof.** Make 15 to 20 real test takes. Run blind side by sides against CapCut and the original, and ask "does it look filmed in a studio?". Track render time and cost per minute.

**Build order.**

1. A quick win on today's green screen path (pieces 2 and 3).
2. Test 2 to 3 matting models, plus a hands on competitor test: the same 5 takes through CapCut, VEED, Descript, Captions and Beeble's free tier.
3. AI cut out with the chosen vendor.
4. Smart framing.
5. Backgrounds made for this.

## Costs (estimates from list prices, 2026-11-13)

- **Step 1:** $0 extra (renders get slightly longer).
- **Step 2:** about $20 to $50 one off.
- **Production AI cut out:** pay per second, no monthly fee.
  - Modal: about $0.59 an hour on a T4, $0.80 on an L4, $1.10 on an A10G.
  - Replicate: about $3.51 an hour on an L40S.
  - Robust Video Matting: about $0.05 a run on Replicate, and the project reports 100+ frames per second at 1080p on a mid range GPU. That is inference throughput only; the project says its video conversion script is much slower, so real end to end speed will be lower.
  - Budget about 1 minute of GPU per minute of video: a fast model about $0.01 to $0.06 per minute of video, a top quality model about $0.05 to $0.20.
  - A creator making 50 minutes a month would cost us about $0.50 to $10 a month.

## Is anyone doing it already? (not certain; web research only)

- **Background swap:** CapCut, VEED, Descript, Vmake, Higgsfield. None say they match lighting to the scene.
- **Relighting for film pros:** Beeble SwitchLight and Virtual Studio. It started as desktop software aimed at VFX, and it now also offers relighting in the browser that works without a green screen (vp-land.com). Its model powers OpenArt's background changer. This is closer competition than first noted.
- **Live webcam lighting:** NVIDIA Broadcast Virtual Key Light. It evens out face light but does not match the scene.
- **Not found:** a simple, phone first product that does cut out, matched light, shadow, framing, pause removal and transcript automatically. The idea is not a moat. Doing it really well for one audience first is.

## Sources

- https://www.overseeros.com/blog/what-youtube-creators-struggle-with-most
- https://subscut.com/blogs/Best-Descript-alternatives-2026
- https://www.moonb.io/blog/best-ai-video-editor
- https://www.flowjam.com/blog/capcut-vs-veed-2026
- https://replicate.com/pricing
- https://replicate.com/arielreplicate/robust_video_matting
- https://www.spheron.network/blog/modal-gpu-pricing-2026-per-second-billing/
- https://github.com/PeterL1n/RobustVideoMatting
- https://www.cgchannel.com/2024/08/tools-to-watch-in-fall-2024-switchlight-studio/
- https://www.nvidia.com/en-us/geforce/broadcasting/broadcast-app/
- https://www.magnific.com/blog/video-background-changer/
- https://openart.ai/features/ai-video-background-changer/
- https://www.vp-land.com/stories/beeble-ai-brings-professional-relighting-to-your-web-browser
