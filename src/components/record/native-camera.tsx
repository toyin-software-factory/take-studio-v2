"use client";

import { useRef } from "react";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/**
 * The way forward on a phone whose browser cannot record in the page (AC-5): the phone's own
 * camera app through a file input. The file it makes goes through the normal upload.
 */
export function NativeCamera({ onFile }: { readonly onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="video/*"
        capture="user"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="native-camera-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
      <Button size="lg" variant="secondary" onClick={() => input.current?.click()}>
        <Icon icon={Smartphone} /> Record with your phone&rsquo;s camera
      </Button>
    </>
  );
}
