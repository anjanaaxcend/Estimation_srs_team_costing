import * as React from "react";
import { cn } from "./utils";

function Alert({ className, variant = "default", ...props }) {
  return (
    <div
      role="alert"
      data-slot="alert"
      className={cn(
        "relative w-full rounded-2xl border p-4 text-sm flex gap-3 items-start",
        variant === "destructive"
          ? "border-blue-500/25 bg-blue-500/10 text-blue-200"
          : "border-slate-300/50 bg-white/4 text-slate-300",
        className,
      )}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }) {
  return (
    <div
      data-slot="alert-title"
      className={cn("font-semibold leading-snug tracking-tight text-slate-700 mb-0.5", className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }) {
  return (
    <div
      data-slot="alert-description"
      className={cn("text-sm leading-relaxed", className)}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription };
