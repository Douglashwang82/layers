import type { ReactNode } from "react";
/** Label, help text and error text associated with one control by id. */
export function Field({
  id,
  label,
  help,
  error,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  help?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`field${className ? ` ${className}` : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {help && (
        <small className="field-help" id={`${id}-help`}>
          {help}
        </small>
      )}
      {error && (
        <small className="error-message" id={`${id}-error`}>
          {error}
        </small>
      )}
    </div>
  );
}
/** aria attributes for the control inside a Field. */
export function fieldProps(
  id: string,
  { help, error }: { help?: boolean; error?: string },
) {
  const described = [help ? `${id}-help` : "", error ? `${id}-error` : ""]
    .filter(Boolean)
    .join(" ");
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": described || undefined,
  } as const;
}
