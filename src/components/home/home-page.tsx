import { SkipLink } from "@/components/shell/skip-link";
import { HomeCapabilities } from "./capabilities";
import { HomeClosing } from "./closing";
import { HomeFaq } from "./faq";
import { HomeFooter } from "./footer";
import { HomeHero } from "./hero";
import { JsonLd } from "./json-ld";
import { HomeLimits } from "./limits";
import { HomeNav } from "./nav";
import { HomeProof } from "./proof";
import { HomeReel } from "./reel";
import { HomeStudio } from "./studio";
import "./home.css";

/**
 * The signed out homepage (spec 0010, AC-1): ten sections in order, server rendered, no motion
 * yet. Nav, hero, reel, made for solo creators, the studio floor, what it does, the limits,
 * questions, the closing call to action, footer. The `noscript` style opens the answers for a
 * visitor without scripts.
 */
export function HomePage({ origin }: { readonly origin: string | null }) {
  return (
    <div className="home">
      <JsonLd origin={origin} />
      <noscript>
        <style>{".home .h-acc-panel{display:block !important}"}</style>
      </noscript>
      <SkipLink target="main" />
      <HomeNav />
      <main id="main" tabIndex={-1}>
        <HomeHero />
        <HomeReel />
        <HomeProof />
        <HomeStudio />
        <HomeCapabilities />
        <HomeLimits />
        <HomeFaq />
        <HomeClosing />
      </main>
      <HomeFooter />
    </div>
  );
}
