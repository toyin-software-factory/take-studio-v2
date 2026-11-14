import { DEEPGRAM_OPTS_OUT, PROCESSORS } from "@/lib/legal-facts";
import { LegalSection } from "./section";

/** The services that touch your data (AC-4), from one registry. */
export function ServicesSection() {
  return (
    <LegalSection id="services" title="Who else handles your data">
      <p>
        We use the services below to run Take Studio. We do not sell your data, and we do not use
        your videos or transcripts to train any model.
        {DEEPGRAM_OPTS_OUT
          ? " We tell Deepgram not to use your audio to train its models."
          : ""}{" "}
        The AI step sees transcript words, which words the transcriber was unsure of, and where the
        pauses are, and your script when the take has one, never your video or your audio. If you
        connect an AI assistant to your account with your own API key, that assistant can read your
        takes, their transcripts, cut reasons and video links, under its own terms and privacy
        policy. We send it only what it asks for through your key.
      </p>
      <dl className="flex flex-col gap-4">
        {PROCESSORS.map((p) => (
          <div key={p.id} className="flex flex-col gap-1">
            <dt className="text-h4">{p.name}</dt>
            <dd>{p.role}</dd>
            <dd>
              <span className="text-muted-foreground">Receives:</span> {p.receives}
            </dd>
            <dd>
              <span className="text-muted-foreground">Does not receive:</span> {p.doesNotReceive}
            </dd>
            <dd>
              <span className="text-muted-foreground">Where:</span> {p.location}
            </dd>
          </div>
        ))}
      </dl>
    </LegalSection>
  );
}
