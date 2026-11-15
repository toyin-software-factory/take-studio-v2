import {
  CHOICES,
  COLLECTED,
  COOKIES,
  DEVICE_STORAGE,
  privacyContactEmail,
  type LegalEntity,
} from "@/lib/legal-facts";
import { LegalList, LegalSection } from "./section";

/** What we collect and why (AC-5): one table, the cookie, and the creator's choices. */
export function CollectedSection() {
  return (
    <LegalSection id="collect" title="What we collect, why, and how long we keep it">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left">
          <caption className="sr-only">What Take Studio stores about you</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="py-2 pr-4 font-normal text-muted-foreground">
                What
              </th>
              <th scope="col" className="py-2 pr-4 font-normal text-muted-foreground">
                Why
              </th>
              <th scope="col" className="py-2 pr-4 font-normal text-muted-foreground">
                How long
              </th>
              <th scope="col" className="py-2 font-normal text-muted-foreground">
                Removed with
              </th>
            </tr>
          </thead>
          <tbody>
            {COLLECTED.map((row) => (
              <tr key={row.what} className="border-b border-line align-top">
                <th scope="row" className="py-2 pr-4 font-normal">
                  {row.what}
                </th>
                <td className="py-2 pr-4">{row.why}</td>
                <td className="py-2 pr-4">{row.kept}</td>
                <td className="py-2">{row.deletedWith}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LegalSection>
  );
}

export function CookiesSection() {
  return (
    <LegalSection id="cookies" title="Cookies and device storage">
      <p>
        We set one cookie, and it is needed to keep you signed in. We use no advertising cookie and
        no analytics cookie.
      </p>
      <LegalList
        items={COOKIES.map((c) => (
          <>
            <code>{c.name}</code>: {c.purpose} Kept: {c.kept}
          </>
        ))}
      />
      <p>
        Your browser also keeps a few things for the site on your own device. They are your own
        settings and an unsent draft, they are not cookies and we do not read them, and they are
        needed for the features to work, so there is nothing to accept.
      </p>
      <LegalList
        items={DEVICE_STORAGE.map((d) => (
          <>
            <code>{d.name}</code> (
            {d.store === "localStorage" ? "local storage" : "session storage"}
            ): {d.holds} Cleared: {d.cleared}
          </>
        ))}
      />
    </LegalSection>
  );
}

export function ChoicesSection({ entity }: Readonly<{ entity: LegalEntity }>) {
  return (
    <LegalSection id="choices" title="Your choices and how to reach us">
      <LegalList items={CHOICES} />
      <p>
        For any request about your data, write to{" "}
        <a href={`mailto:${privacyContactEmail(entity)}`} className="underline underline-offset-4">
          {privacyContactEmail(entity)}
        </a>
        .
      </p>
    </LegalSection>
  );
}
