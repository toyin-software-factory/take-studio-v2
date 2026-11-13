# Homepage: every difference design-check still finds (B-T10)

Source: `.design-check/result.json` from one `check --page home` run after the B-T10 change (round 1 after `--reset`). It has every fail and flag the tool found, with nothing left out for length. Values read "build against design". Nothing here was fixed beyond the drift rows.

Tags: **accepted, guard rail** (we keep it on purpose), **layout choice from an earlier spec**, **not fixed yet**.

Totals: 103 lines, of which 41 layout choice from an earlier spec, 34 accepted, guard rail, 28 not fixed yet.


## header (screenshot differs: desktop 4%, phone 9%)


### desktop

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `header` | motion-hover-props | hover motion does not move padding-left, padding-right; design moves color, border-bottom-left-radius, border-bottom-right-radius, border-top-left-radius, border-top-right-radius, height, padding-left, padding-right, top, width, build moves color, border-bottom-left-radius, border-bottom-right-radius, border-top-left-radius, border-top-right-radius, height, top, width | **layout choice from an earlier spec**: our nav glass pill and its states (spec 0010) |

### desktop + phone

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `header` | motion-scroll-props | scroll motion does not move padding-left, padding-right; design moves color, border-bottom-left-radius, border-bottom-right-radius, border-top-left-radius, border-top-right-radius, height, padding-left, padding-right, top, width, build moves color, border-bottom-left-radius, border-bottom-right-radius, border-top-left-radius, border-top-right-radius, height, top, width | **layout choice from an earlier spec**: our nav glass pill and its states (spec 0010) |
| `header` | motion-load-props | load motion does not move opacity; design moves opacity, build moves color | **layout choice from an earlier spec**: our nav glass pill and its states (spec 0010) |
| `header` | motion-load-duration | load motion lasts 200ms, design 460ms | **layout choice from an earlier spec**: our nav glass pill and its states (spec 0010) |
| `header` | motion-load-easing | load easing ease, design none (the curves differ by 30% at most) | **layout choice from an earlier spec**: our nav glass pill and its states (spec 0010) |

## nav


### desktop

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `nav` | x | left edge inside header: 1248px, design 1254px | **accepted, guard rail**: 44 px nav targets (WCAG 2.5.8 and the project's 44 px rule); the bar centres the 44 px row, so the top edge and width follow |
| `nav` | y | top edge inside header: 18px, design 28px | **accepted, guard rail**: 44 px nav targets (WCAG 2.5.8 and the project's 44 px rule); the bar centres the 44 px row, so the top edge and width follow |
| `nav` | width | width 385px, design 373px | **accepted, guard rail**: 44 px nav targets (WCAG 2.5.8 and the project's 44 px rule); the bar centres the 44 px row, so the top edge and width follow |
| `nav` | height | height 44px, design 24px | **accepted, guard rail**: 44 px nav targets (WCAG 2.5.8 and the project's 44 px rule); the bar centres the 44 px row, so the top edge and width follow |

## s1


### phone

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `s1-top` | height | height 861px, design 801px | **not fixed yet**: phone fan cards are 180x252 in the build and 160x224 in the draft |
| `s1-top-list` | height | height 360px, design 300px | **not fixed yet**: phone fan cards are 180x252 in the build and 160x224 in the draft |
| `s1-top-media` | width | width 180px, design 160px | **not fixed yet**: phone fan cards are 180x252 in the build and 160x224 in the draft |
| `s1-top-media` | height | height 252px, design 224px | **not fixed yet**: phone fan cards are 180x252 in the build and 160x224 in the draft |
| `s1-top-media-2` | width | width 180px, design 160px | **not fixed yet**: phone fan cards are 180x252 in the build and 160x224 in the draft |
| `s1-top-media-2` | height | height 252px, design 224px | **not fixed yet**: phone fan cards are 180x252 in the build and 160x224 in the draft |
| `s1-top-media-3` | width | width 180px, design 160px | **not fixed yet**: phone fan cards are 180x252 in the build and 160x224 in the draft |
| `s1-top-media-3` | height | height 252px, design 224px | **not fixed yet**: phone fan cards are 180x252 in the build and 160x224 in the draft |
| `s1-top-media-4` | width | width 180px, design 160px | **not fixed yet**: phone fan cards are 180x252 in the build and 160x224 in the draft |
| `s1-top-media-4` | height | height 252px, design 224px | **not fixed yet**: phone fan cards are 180x252 in the build and 160x224 in the draft |

### desktop + phone

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `s1-top-list` | clipped | content is cut off (overflows its box); in the design it fits | **not fixed yet**: the first list overflows its box in the build; in the draft it fits |
| `s1-top-heading` | motion-load | no load motion; design has load: inline-style of transform, translate, scale, rotate (on a child); load: gsap of yPercent 1500ms power2.out (on a child); load: gsap of yPercent 1500ms power2.out (on a child) | **layout choice from an earlier spec**: spec 0010 AC-10: the headline and lead are never hidden or moved at load |
| `s1-top-text` | motion-load | no load motion; design has load: inline-style of transform, opacity, translate, scale; load: gsap of y, opacity 700ms custom | **layout choice from an earlier spec**: spec 0010 AC-10: the headline and lead are never hidden or moved at load |
| `s1-top-item` | motion-load-props | load motion does not move modifiers; design moves transform, modifiers, build moves transform | **layout choice from an earlier spec**: spec 0010 AC-10: the headline and lead are never hidden or moved at load |

## s2


### desktop

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `s2-reel-media` | transform | a transform draws it shifted -108,-68px at scale 1.15×1.15; design shifted 295,-51px at scale 1.15×1.15 | **layout choice from an earlier spec**: reel pin and expansion is our own gsap setup (spec 0010 task 2); the tool measures it mid scroll, and does not detect our scrub |
| `s2-reel-cta` | visible | is visible in the build but hidden in the design | **accepted, guard rail**: reel play/pause button stays (WCAG 2.2.2) |
| `s2-reel-heading` | motion-scroll-scrub | no scroll-scrub motion; design has scroll-scrub: gsap of opacity 400ms none | **layout choice from an earlier spec**: reel pin and expansion is our own gsap setup (spec 0010 task 2); the tool measures it mid scroll, and does not detect our scrub |
| `s2-reel` | motion-scroll-scrub | no scroll-scrub motion; design has scroll-scrub: gsap of clipPath 500ms none (on a child) | **layout choice from an earlier spec**: reel pin and expansion is our own gsap setup (spec 0010 task 2); the tool measures it mid scroll, and does not detect our scrub |
| `s2-reel-media` | motion-scroll-scrub | no scroll-scrub motion; design has scroll-scrub: gsap of scale, x, y 500ms none | **layout choice from an earlier spec**: reel pin and expansion is our own gsap setup (spec 0010 task 2); the tool measures it mid scroll, and does not detect our scrub |
| `s2-reel-cta` | motion-extra | has hover motion that the design does not have (hover: css-transition of border-bottom-color 300ms cubic-bezier(0.44, 0, 0.56, 1)) | **accepted, guard rail**: reel play/pause button stays (WCAG 2.2.2) |
| `s2-reel` | motion-extra | has load motion that the design does not have (load: inline-style of clip-path (on a child)) | **layout choice from an earlier spec**: reel pin and expansion is our own gsap setup (spec 0010 task 2); the tool measures it mid scroll, and does not detect our scrub |
| `s2-reel-media` | motion-extra | has load motion that the design does not have (load: inline-style of transform, translate, scale, rotate) | **layout choice from an earlier spec**: reel pin and expansion is our own gsap setup (spec 0010 task 2); the tool measures it mid scroll, and does not detect our scrub |

### phone

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `s2-reel` | height | height 534px, design 518px | **not fixed yet**: phone reel layout: ours is the plain inline video (spec 0010), spacing and radius differ from the draft |
| `s2-reel-heading` | width | width 240px, design 252px | **not fixed yet**: phone reel layout: ours is the plain inline video (spec 0010), spacing and radius differ from the draft |
| `s2-reel-heading` | margin-bottom | margin-bottom 48px, design 0px | **not fixed yet**: phone reel layout: ours is the plain inline video (spec 0010), spacing and radius differ from the draft |
| `s2-reel-media` | y | gap below s2-reel-heading: 48px, design 32px | **not fixed yet**: phone reel layout: ours is the plain inline video (spec 0010), spacing and radius differ from the draft |
| `s2-reel-media` | border-radius | border-radius 10px, design 0px | **not fixed yet**: phone reel layout: ours is the plain inline video (spec 0010), spacing and radius differ from the draft |
| `s2-reel-cta` | x | left edge inside s2-reel: 314px, design 195px | **accepted, guard rail**: reel play/pause button stays (WCAG 2.2.2); the draft's 72 px lime button is decorative only |
| `s2-reel-cta` | y | gap below s2-reel-heading: 189px, design 130px | **accepted, guard rail**: reel play/pause button stays (WCAG 2.2.2); the draft's 72 px lime button is decorative only |
| `s2-reel-cta` | width | width 44px, design 72px | **accepted, guard rail**: reel play/pause button stays (WCAG 2.2.2); the draft's 72 px lime button is decorative only |
| `s2-reel-cta` | height | height 44px, design 72px | **accepted, guard rail**: reel play/pause button stays (WCAG 2.2.2); the draft's 72 px lime button is decorative only |
| `s2-reel-cta` | font-size | font-size 16px, design 12px | **accepted, guard rail**: reel play/pause button stays (WCAG 2.2.2); the draft's 72 px lime button is decorative only |
| `s2-reel-cta` | line-height | line-height 24px, design 18px | **accepted, guard rail**: reel play/pause button stays (WCAG 2.2.2); the draft's 72 px lime button is decorative only |
| `s2-reel-cta` | color | color #ffffff, design #030303 (difference 90.3) | **accepted, guard rail**: reel play/pause button stays (WCAG 2.2.2); the draft's 72 px lime button is decorative only |
| `s2-reel-cta` | background | background #000000 at 30%, design #cdff59 (difference 95.5) | **accepted, guard rail**: reel play/pause button stays (WCAG 2.2.2); the draft's 72 px lime button is decorative only |
| `s2-reel-cta` | padding | padding 0px 0px 0px 0px, design 1px 6px 1px 6px (top right bottom left) | **accepted, guard rail**: reel play/pause button stays (WCAG 2.2.2); the draft's 72 px lime button is decorative only |
| `s2-reel-cta` | border-radius | border-radius 999px, design 50px | **accepted, guard rail**: reel play/pause button stays (WCAG 2.2.2); the draft's 72 px lime button is decorative only |
| `s2-reel-cta` | border-width | border-width 1px, design 0px | **accepted, guard rail**: reel play/pause button stays (WCAG 2.2.2); the draft's 72 px lime button is decorative only |
| `s2-reel-cta` | transform | a transform draws it shifted 0,0px at scale 1×1; design shifted -36,-36px at scale 1×1 | **accepted, guard rail**: reel play/pause button stays (WCAG 2.2.2); the draft's 72 px lime button is decorative only |

### desktop + phone

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `s2-reel-media` | background | background #010101, design #000000 (difference 6.7) | **accepted, guard rail**: colours stay in tokens (--color-dark); a 1/255 difference cannot be seen |
| `s2-reel-heading` | motion-extra | has load motion that the design does not have (load: inline-style of transform, translate, scale, rotate (on a child)) | **layout choice from an earlier spec**: reel pin and expansion is our own gsap setup (spec 0010 task 2); the tool measures it mid scroll, and does not detect our scrub |

## s3


### desktop

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `s3-you-film-alone-list` | transform | a transform draws it shifted -118,0px at scale 1×1; design shifted 0,0px at scale 1×1 | **not fixed yet**: the drift is scroll scrubbed and the tool measures it mid scroll; probably not a real difference |
| `s3-you-film-alone-item` | width | width 121px, design 118px | **not fixed yet**: text width differs by about 3 px: the sandbox has no Inter Tight, so a fallback font is measured |
| `s3-you-film-alone-item` | transform | a transform draws it shifted -118,0px at scale 1×1; design shifted 0,0px at scale 1×1 | **not fixed yet**: the drift is scroll scrubbed and the tool measures it mid scroll; probably not a real difference |

### phone

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `s3-you-film-alone-list` | transform | a transform draws it shifted -32,0px at scale 1×1; design shifted 0,0px at scale 1×1 | **not fixed yet**: the drift is scroll scrubbed and the tool measures it mid scroll; probably not a real difference |
| `s3-you-film-alone-item` | width | width 91px, design 88px | **not fixed yet**: text width differs by about 3 px: the sandbox has no Inter Tight, so a fallback font is measured |
| `s3-you-film-alone-item` | transform | a transform draws it shifted -32,0px at scale 1×1; design shifted 0,0px at scale 1×1 | **not fixed yet**: the drift is scroll scrubbed and the tool measures it mid scroll; probably not a real difference |

### desktop + phone

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `s3-you-film-alone-item` | color | color #4f4f4f, design #030303 (difference 33.1) | **accepted, guard rail**: drift words keep muted #4f4f4f, not 40% opacity (AA contrast) |
| `s3-you-film-alone-item` | opacity | opacity 1, design 0.4 | **accepted, guard rail**: drift words keep muted #4f4f4f, not 40% opacity (AA contrast) |
| `s3-you-film-alone-list` | motion-scroll-scrub | no scroll-scrub motion; design has scroll-scrub: gsap of xPercent 500ms none | **not fixed yet**: our drift does scrub (B-T10 runs it at every width); the tool still reports none |
| `s3-you-film-alone` | motion-scroll-scrub | no scroll-scrub motion; design has scroll-scrub: gsap of xPercent 500ms none (on a child) | **not fixed yet**: our drift does scrub (B-T10 runs it at every width); the tool still reports none |
| `s3-you-film-alone-list` | motion-extra | has load motion that the design does not have (load: inline-style of transform, translate, scale, rotate) | **layout choice from an earlier spec**: our own entrance of the section |
| `s3-you-film-alone` | motion-extra | has load motion that the design does not have (load: inline-style of transform, translate, scale, rotate (on a child)) | **layout choice from an earlier spec**: our own entrance of the section |
| `s3-you-film-alone-heading` | motion-extra | has load motion that the design does not have (load: inline-style of transform, translate, scale, rotate (on a child)) | **layout choice from an earlier spec**: our own entrance of the section |

## s4


### desktop

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `s4-studio` | height | height 4484px, design 5226px | **layout choice from an earlier spec**: the draft's mock card art and pinned fill lines are not copied (spec 0010, AGENTS.md); heights and gaps differ |
| `s4-studio-heading-2` | y | gap below s4-studio-media: 1876px, design 2036px | **layout choice from an earlier spec**: the draft's mock card art and pinned fill lines are not copied (spec 0010, AGENTS.md); heights and gaps differ |
| `s4-studio-heading-3` | y | gap below s4-studio-media: 1876px, design 2036px | **layout choice from an earlier spec**: the draft's mock card art and pinned fill lines are not copied (spec 0010, AGENTS.md); heights and gaps differ |
| `s4-studio-cta` | y | gap below s4-studio-heading-4: 506px, design 1089px | **layout choice from an earlier spec**: the draft's mock card art and pinned fill lines are not copied (spec 0010, AGENTS.md); heights and gaps differ |

### phone

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `s4-studio` | height | height 4697px, design 5411px | **layout choice from an earlier spec**: the draft's mock card art and pinned fill lines are not copied (spec 0010, AGENTS.md); heights and gaps differ |
| `s4-studio-heading-2` | y | gap below s4-studio-media: 1748px, design 1828px | **layout choice from an earlier spec**: the draft's mock card art and pinned fill lines are not copied (spec 0010, AGENTS.md); heights and gaps differ |
| `s4-studio-heading-3` | y | gap below s4-studio-heading-2: 306px, design 330px | **layout choice from an earlier spec**: the draft's mock card art and pinned fill lines are not copied (spec 0010, AGENTS.md); heights and gaps differ |
| `s4-studio-cta` | y | gap below s4-studio-heading-5: 421px, design 1031px | **layout choice from an earlier spec**: the draft's mock card art and pinned fill lines are not copied (spec 0010, AGENTS.md); heights and gaps differ |

### desktop + phone

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `s4-studio-text` | color | color #ffffff at 75%, design #ffffff at 60% (difference 0.0) | **accepted, guard rail**: muted text on dark stays at white 75% or lighter (AA contrast) |
| `s4-studio-cta-2` | width | width 255px, design 252px | **accepted, guard rail**: our button label text, not the draft's (our content) |
| `s4-studio-cta-3` | width | width 203px, design 200px | **accepted, guard rail**: our button label text, not the draft's (our content) |
| `s4-studio-cta-4` | x | left edge inside s4-studio-cta-2: 207px, design 204px | **accepted, guard rail**: our button label text, not the draft's (our content) |
| `s4-studio` | motion-scroll-scrub | no scroll-scrub motion; design has scroll-scrub: gsap of --arc-k 500ms none | **not fixed yet**: ours scrubs --arc-k in studio.ts; the tool does not detect it |
| `s4-studio-item` | motion-extra | has load motion that the design does not have (load: inline-style of transform, opacity, translate, scale) | **layout choice from an earlier spec**: our own entrances (spec 0010 task 2); not in the draft |
| `s4-studio-list` | motion-extra | has load motion that the design does not have (load: inline-style of transform, opacity, translate, scale (on a child)) | **layout choice from an earlier spec**: our own entrances (spec 0010 task 2); not in the draft |
| `s4-studio-heading` | motion-extra | has load motion that the design does not have (load: inline-style of transform, translate, scale, rotate (on a child)) | **layout choice from an earlier spec**: our own entrances (spec 0010 task 2); not in the draft |
| `s4-studio-media` | motion-extra | has scroll motion that the design does not have (scroll: inline-style of opacity) | **layout choice from an earlier spec**: our own entrances (spec 0010 task 2); not in the draft |

## s5


### phone

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `s5-capabilities-media` | motion-scroll | no scroll motion; design has scroll: css-transition of transform 600ms cubic-bezier(0.22, 1, 0.36, 1); scroll: css-transition of transform 546ms cubic-bezier(0.22, 1, 0.36, 1) | **not fixed yet**: the draft's tile scale on scroll (phone) is not built |
| `s5-capabilities-media-3` | motion-scroll | no scroll motion; design has scroll: css-transition of transform 600ms cubic-bezier(0.22, 1, 0.36, 1); scroll: css-transition of transform 534ms cubic-bezier(0.22, 1, 0.36, 1) | **not fixed yet**: the draft's tile scale on scroll (phone) is not built |

### desktop + phone

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `s5-capabilities-media` | background | background #010101, design #000000 (difference 6.7) | **accepted, guard rail**: colours stay in tokens (--color-dark); a 1/255 difference cannot be seen |
| `s5-capabilities-media-3` | background | background #010101, design #000000 (difference 6.7) | **accepted, guard rail**: colours stay in tokens (--color-dark); a 1/255 difference cannot be seen |
| `s5-capabilities-media-2` | motion-extra | has load motion that the design does not have (load: css-transition of opacity 300ms cubic-bezier(0.44, 0, 0.56, 1)) | **layout choice from an earlier spec**: our tile video fade and entrance (spec 0010 task 4) |
| `s5-capabilities-media-4` | motion-extra | has load motion that the design does not have (load: css-transition of opacity 300ms cubic-bezier(0.44, 0, 0.56, 1)) | **layout choice from an earlier spec**: our tile video fade and entrance (spec 0010 task 4) |
| `s5-capabilities-list` | motion-extra | has load motion that the design does not have (load: css-transition of opacity 300ms cubic-bezier(0.44, 0, 0.56, 1) (on a child)) | **layout choice from an earlier spec**: our tile video fade and entrance (spec 0010 task 4) |
| `s5-capabilities-heading` | motion-extra | has load motion that the design does not have (load: inline-style of transform, translate, scale, rotate (on a child)) | **layout choice from an earlier spec**: our tile video fade and entrance (spec 0010 task 4) |

## s6


### desktop + phone

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `s6-simple-limits-free-item` | motion-extra | has load motion that the design does not have (load: inline-style of transform (on a child)) | **layout choice from an earlier spec**: our own entrance (spec 0010 task 2) |
| `s6-simple-limits-free-list` | motion-extra | has load motion that the design does not have (load: inline-style of transform (on a child)) | **layout choice from an earlier spec**: our own entrance (spec 0010 task 2) |
| `s6-simple-limits-free-heading` | motion-extra | has load motion that the design does not have (load: inline-style of transform, translate, scale, rotate (on a child)) | **layout choice from an earlier spec**: our own entrance (spec 0010 task 2) |

## s7


### desktop + phone

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `s7-faq-heading` | motion-extra | has load motion that the design does not have (load: inline-style of transform, translate, scale, rotate (on a child)) | **layout choice from an earlier spec**: our own entrance (spec 0010 task 2) |

## s8


### desktop

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `s8-contact` | height | height 406px, design 650px | **layout choice from an earlier spec**: no email form in s8 (spec 0010), so the section is shorter |
| `s8-contact-cta` | y | top edge inside s8-contact: 157px, design 365px | **accepted, guard rail**: our button label text, not the draft's (our content) |

### phone

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `s8-contact` | height | height 432px, design 884px | **layout choice from an earlier spec**: no email form in s8 (spec 0010), so the section is shorter |
| `s8-contact-cta` | y | gap below s8-contact-heading: 146px, design 561px | **accepted, guard rail**: our button label text, not the draft's (our content) |

### desktop + phone

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `s8-contact-cta` | width | width 255px, design 193px | **accepted, guard rail**: our button label text, not the draft's (our content) |
| `s8-contact-cta` | text-align | text-align start, design center | **not fixed yet**: build button text is start aligned; draft centres it |
| `s8-contact-cta-2` | width | width 203px, design 141px | **accepted, guard rail**: our button label text, not the draft's (our content) |
| `s8-contact-cta-3` | x | left edge inside s8-contact-cta: 207px, design 145px | **accepted, guard rail**: our button label text, not the draft's (our content) |
| `s8-contact-heading` | motion-extra | has load motion that the design does not have (load: inline-style of transform, translate, scale, rotate (on a child)) | **layout choice from an earlier spec**: no email form in s8 (spec 0010), so the section is shorter |

## footer (screenshot differs: desktop 20%, phone 11%)


### desktop

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `footer` | height | height 713px, design 663px | **accepted, guard rail**: footer links keep 44 px targets (draft 24 px with a 10 px gap) |

### phone

| Element | What differs | Build against design | Tag |
|---|---|---|---|
| `footer` | height | height 1053px, design 1025px | **accepted, guard rail**: footer links keep 44 px targets (draft 24 px with a 10 px gap) |
