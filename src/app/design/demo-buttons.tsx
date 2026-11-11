import { Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { DemoBlock, DemoGroup } from "./demo-block";

const variants = ["primary", "secondary", "ghost", "destructive", "link"] as const;

/** Every Button variant, size and state. Hover, pressed and focus are shown as fixed samples. */
export function ButtonDemos() {
  return (
    <DemoGroup title="Button">
      <DemoBlock title="Variants">
        {variants.map((variant) => (
          <Button key={variant} variant={variant}>
            {variant === "destructive" ? "Delete take" : "Render"}
          </Button>
        ))}
      </DemoBlock>
      <DemoBlock title="Sizes: sm, md, lg, icon">
        <Button size="sm">Download</Button>
        <Button size="md">Download</Button>
        <Button size="lg">
          <Icon icon={Download} />
          Download
        </Button>
        <Button size="icon" variant="secondary" aria-label="Download">
          <Icon icon={Download} />
        </Button>
        <Button size="icon" variant="ghost" aria-label="Delete take">
          <Icon icon={Trash2} />
        </Button>
      </DemoBlock>
      <DemoBlock title="States: default, hover, pressed, focus, disabled, loading">
        <Button>Default</Button>
        <Button className="bg-primary-hover">Hover</Button>
        <Button className="bg-primary-active">Pressed</Button>
        <Button className="outline-2 outline-offset-2 outline-ring">Focus</Button>
        <Button disabled>Disabled</Button>
        <Button loading>Rendering</Button>
      </DemoBlock>
      <DemoBlock title="Secondary and destructive states">
        <Button variant="secondary" className="bg-accent">
          Hover
        </Button>
        <Button variant="secondary" disabled>
          Disabled
        </Button>
        <Button variant="destructive" className="bg-danger-hover">
          Hover
        </Button>
        <Button variant="destructive" loading>
          Deleting
        </Button>
      </DemoBlock>
    </DemoGroup>
  );
}
