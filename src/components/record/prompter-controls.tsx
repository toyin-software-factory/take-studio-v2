"use client";

import { Minus, Pause, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { Prompter } from "./use-prompter";

/**
 * Pause and resume the script, speed and text size. Buttons and keyboard shortcuts (P, Up and
 * Down, + and -) do the same thing. Pausing the script never pauses the recording. Changes are
 * announced politely once, never every second.
 */
export function PrompterControls({ prompter }: { readonly prompter: Prompter }) {
  const { settings, paused, run, announcement } = prompter;
  return (
    <div
      role="group"
      aria-label="Script controls"
      data-testid="prompter-controls"
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      <Button
        variant="secondary"
        onClick={() => run("toggle")}
        aria-keyshortcuts="P"
        data-testid="prompter-toggle"
      >
        <Icon icon={paused ? Play : Pause} /> {paused ? "Resume script" : "Pause script"}
      </Button>
      <Stepper
        label="Speed"
        value={`${settings.wpm} wpm`}
        lessLabel="Slower"
        moreLabel="Faster"
        onLess={() => run("slower")}
        onMore={() => run("faster")}
        testId="prompter-speed"
      />
      <Stepper
        label="Text size"
        value={`${settings.size} px`}
        lessLabel="Smaller text"
        moreLabel="Larger text"
        onLess={() => run("smaller")}
        onMore={() => run("larger")}
        testId="prompter-size"
      />
      <p className="w-full text-small text-muted-foreground">
        Keys: P pause, Up and Down speed, + and − size. The recording keeps going.
      </p>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

function Stepper({
  label,
  value,
  lessLabel,
  moreLabel,
  onLess,
  onMore,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly lessLabel: string;
  readonly moreLabel: string;
  readonly onLess: () => void;
  readonly onMore: () => void;
  readonly testId: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2">
      <Button variant="secondary" size="icon" aria-label={lessLabel} onClick={onLess}>
        <Icon icon={Minus} />
      </Button>
      <span className="mono min-w-20 text-center text-small" data-testid={testId}>
        {value}
      </span>
      <Button variant="secondary" size="icon" aria-label={moreLabel} onClick={onMore}>
        <Icon icon={Plus} />
      </Button>
    </div>
  );
}
