import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DemoGroup } from "./demo-block";

/** Inputs with label, helper and error rules, plus the choice controls. */
export function FormDemos({ idPrefix }: { readonly idPrefix: string }) {
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <DemoGroup title="Inputs and controls">
      <div className="grid gap-6 md:grid-cols-2">
        <Field id={id("title")} label="Take title" helper="Shown in your library." required>
          {(props) => <Input placeholder="My take" {...props} />}
        </Field>
        <Field
          id={id("duration")}
          label="Trim pauses longer than"
          error="Enter a number of seconds, like 1.5."
          required
        >
          {(props) => <Input defaultValue="one second" {...props} />}
        </Field>
        <Field id={id("disabled")} label="Background (disabled)">
          {(props) => <Input defaultValue="Warm podcast studio" disabled {...props} />}
        </Field>
        <Field id={id("readonly")} label="File name (read only)">
          {(props) => <Input defaultValue="interview-take-3.mov" readOnly {...props} />}
        </Field>
        <Field id={id("notes")} label="Notes" helper="Only you can see these.">
          {(props) => <Textarea placeholder="What to fix in the next take" {...props} />}
        </Field>
        <Field id={id("quality")} label="Export quality">
          {(props) => (
            <Select defaultValue="1080p">
              <SelectTrigger className="w-full" {...props}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
                <SelectItem value="4k" disabled>
                  4K (not available)
                </SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2">
          <Checkbox id={id("captions")} defaultChecked />
          <Label htmlFor={id("captions")}>Burn in captions</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id={id("filler")} />
          <Label htmlFor={id("filler")}>Remove filler words</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id={id("locked")} disabled />
          <Label htmlFor={id("locked")}>Locked option (disabled)</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id={id("auto")} defaultChecked />
          <Label htmlFor={id("auto")}>Trim automatically</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id={id("off")} />
          <Label htmlFor={id("off")}>Swap background</Label>
        </div>
      </div>
      <div className="grid max-w-md gap-2">
        <Label id={id("zoom-label")}>Timeline zoom</Label>
        <Slider defaultValue={[40]} max={100} step={1} aria-labelledby={id("zoom-label")} />
      </div>
    </DemoGroup>
  );
}
