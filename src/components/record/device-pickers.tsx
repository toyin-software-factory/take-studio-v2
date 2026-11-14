"use client";

import { SwitchCamera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DeviceChoice, DeviceChoices } from "@/lib/recorder-devices";

function Picker({
  id,
  label,
  choices,
  value,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly choices: readonly DeviceChoice[];
  readonly value: string | null;
  readonly disabled: boolean;
  readonly onChange: (id: string) => void;
}) {
  if (choices.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value ?? choices[0]?.id} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {choices.map((choice) => (
            <SelectItem key={choice.id} value={choice.id}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Camera and microphone pickers and "Flip camera" (AC-1), locked once the countdown starts. */
export function DevicePickers({
  choices,
  cameraId,
  micId,
  locked,
  onCamera,
  onMic,
  onFlip,
}: {
  readonly choices: DeviceChoices;
  readonly cameraId: string | null;
  readonly micId: string | null;
  readonly locked: boolean;
  readonly onCamera: (id: string) => void;
  readonly onMic: (id: string) => void;
  readonly onFlip: (() => void) | null;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Picker
        id="record-camera"
        label="Camera"
        choices={choices.cameras}
        value={cameraId}
        disabled={locked}
        onChange={onCamera}
      />
      <Picker
        id="record-microphone"
        label="Microphone"
        choices={choices.microphones}
        value={micId}
        disabled={locked}
        onChange={onMic}
      />
      {onFlip ? (
        <Button variant="secondary" size="lg" disabled={locked} onClick={onFlip}>
          <Icon icon={SwitchCamera} /> Flip camera
        </Button>
      ) : null}
    </div>
  );
}
