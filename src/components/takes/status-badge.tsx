import {
  CircleAlert,
  CircleCheck,
  Clock,
  Hourglass,
  LoaderCircle,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { statusBadge } from "@/lib/take-display";

const ICONS: Readonly<Record<string, LucideIcon>> = {
  uploading: Upload,
  uploaded: Hourglass,
  processing: LoaderCircle,
  ready: CircleCheck,
  failed: CircleAlert,
  expired: Clock,
};

/** A take's status as icon plus label (design.md: never colour alone). */
export function StatusBadge({ status }: { readonly status: string }) {
  const { label, tone } = statusBadge(status);
  return (
    <Badge variant={tone} icon={ICONS[status] ?? Clock}>
      {label}
    </Badge>
  );
}
