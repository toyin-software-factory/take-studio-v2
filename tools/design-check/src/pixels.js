// Pixel comparison of two section screenshots, done in a blank Chromium page (no extra deps).
// Returns the share of differing pixels and writes JPEG copies (design, build, diff) used by
// the report and the judge.
import fs from "node:fs";

export async function comparePixels(browser, designPng, buildPng, outPrefix, maxW = 900) {
  const page = await browser.newPage();
  try {
    const toData = (f) => "data:image/png;base64," + fs.readFileSync(f).toString("base64");
    const res = await page.evaluate(
      async ({ a, b, maxW }) => {
        const load = (src) =>
          new Promise((ok, no) => {
            const i = new Image();
            i.onload = () => ok(i);
            i.onerror = no;
            i.src = src;
          });
        const [A, B] = await Promise.all([load(a), load(b)]);
        const w = A.width,
          h = Math.max(A.height, B.height);
        const c = (W, H) =>
          Object.assign(document.createElement("canvas"), { width: W, height: H });
        const ca = c(w, h),
          cb = c(w, h);
        const xa = ca.getContext("2d"),
          xb = cb.getContext("2d");
        xa.fillStyle = xb.fillStyle = "#ff00ff";
        xa.fillRect(0, 0, w, h);
        xb.fillRect(0, 0, w, h);
        xa.drawImage(A, 0, 0);
        xb.drawImage(B, 0, 0, w, B.height * (w / B.width)); // same width, top aligned; extra height shows as difference
        const da = xa.getImageData(0, 0, w, h).data,
          db = xb.getImageData(0, 0, w, h).data;
        const cd = c(w, h),
          xd = cd.getContext("2d");
        xd.globalAlpha = 0.35;
        xd.drawImage(A, 0, 0);
        xd.globalAlpha = 1;
        const diff = xd.getImageData(0, 0, w, h);
        let n = 0;
        for (let i = 0; i < da.length; i += 4) {
          const d =
            Math.abs(da[i] - db[i]) +
            Math.abs(da[i + 1] - db[i + 1]) +
            Math.abs(da[i + 2] - db[i + 2]);
          if (d > 60) {
            n++;
            diff.data[i] = 255;
            diff.data[i + 1] = 30;
            diff.data[i + 2] = 60;
            diff.data[i + 3] = 255;
          }
        }
        xd.putImageData(diff, 0, 0);
        const jpg = (src, H, mw = maxW, q = 0.72, mh = 1568) => {
          // Jev takes images up to 1568 px a side: scale the whole section down to fit, never crop.
          const scale = Math.min(1, mw / w, mh / Math.max(1, H));
          const W2 = Math.max(1, Math.round(w * scale)),
            H2 = Math.max(1, Math.round(H * scale));
          const t = c(W2, H2);
          t.getContext("2d").drawImage(src, 0, 0, W2, H2);
          return t.toDataURL("image/jpeg", q);
        };
        return {
          ratio: n / (w * h),
          dh: B.height * (w / B.width) - A.height,
          design: jpg(A, A.height * 1),
          build: jpg(B, B.height * (w / B.width)),
          diff: jpg(cd, h),
          // Smaller copies for the HTML report, so it opens quickly on a phone. Jev gets the above.
          small: {
            design: jpg(A, A.height, 420, 0.5, 1200),
            build: jpg(B, B.height * (w / B.width), 420, 0.5, 1200),
            diff: jpg(cd, h, 420, 0.5, 1200),
          },
        };
      },
      { a: toData(designPng), b: toData(buildPng), maxW },
    );
    const save = (data, suffix) => {
      const f = `${outPrefix}-${suffix}.jpg`;
      fs.writeFileSync(f, Buffer.from(data.split(",")[1], "base64"));
      return f;
    };
    return {
      ratio: res.ratio,
      heightDiff: Math.round(res.dh),
      design: save(res.design, "design"),
      build: save(res.build, "build"),
      diff: save(res.diff, "diff"),
      small: {
        design: save(res.small.design, "design-sm"),
        build: save(res.small.build, "build-sm"),
        diff: save(res.small.diff, "diff-sm"),
      },
    };
  } finally {
    await page.close();
  }
}
