import * as React from "react";
import { CircleAlert } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** The attributes a Field hands to its control so label, helper and error are linked. */
export type FieldControlProps = {
  readonly id: string;
  readonly "aria-describedby"?: string;
  readonly "aria-invalid"?: true;
  readonly required?: boolean;
};

type FieldProps = {
  readonly id: string;
  readonly label: string;
  readonly helper?: string;
  /** When set, the control gets a danger border and this message is shown and announced. */
  readonly error?: string;
  readonly required?: boolean;
  readonly className?: string;
  /** Render the control with the props given (`{(props) => <Input {...props} />}`). */
  readonly children: (props: FieldControlProps) => React.ReactNode;
};

/**
 * Form field (design.md, Inputs): label always visible above, "(required)" written in text,
 * helper text below in --text-muted, and on error a danger border plus an icon and message
 * linked with `aria-describedby`.
 */
export function Field({ id, label, helper, error, required, className, children }: FieldProps) {
  const helperId = helper ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, helperId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? <span className="font-normal text-text-muted">(required)</span> : null}
      </Label>
      {children({
        id,
        "aria-describedby": describedBy,
        ...(error ? { "aria-invalid": true as const } : {}),
        required,
      })}
      {error ? (
        <p
          id={errorId}
          className="flex items-start gap-1.5 text-small text-danger in-[.stage]:text-foreground"
        >
          <Icon icon={CircleAlert} size="badge" className="mt-0.5" />
          {error}
        </p>
      ) : null}
      {helper ? (
        <p id={helperId} className="text-small text-text-muted">
          {helper}
        </p>
      ) : null}
    </div>
  );
}
