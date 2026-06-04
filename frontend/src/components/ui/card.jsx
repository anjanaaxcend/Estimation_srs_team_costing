import * as React from "react";
import { cn } from "./utils";

function Card({ className, ...props }) {
  return (
    <div
      data-slot="card"
      className={cn(
        "group relative flex flex-col gap-0 overflow-hidden rounded-2xl border border-white/[0.07] bg-linear-to-br from-white/4 to-white/1.5 text-card-foreground backdrop-blur-xl transition-[transform,border-color,box-shadow,background] duration-500 before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_top,rgba(6,214,199,0.12),transparent_52%)] before:opacity-0 before:transition-opacity before:duration-500 after:pointer-events-none after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-linear-to-r after:from-transparent after:via-[#06d6c7]/55 after:to-transparent after:opacity-70 hover:-translate-y-1 hover:border-[#06d6c7]/20 hover:shadow-[0_24px_72px_rgba(6,214,199,0.14)] hover:before:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1.5 px-6 pt-6 pb-2", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }) {
  return (
    <h4
      data-slot="card-title"
      className={cn("text-xl font-bold leading-snug text-slate-700 tracking-tight", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-[0.72rem] font-700 uppercase tracking-[0.14em] text-[#06d6c7]", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6 pb-6 pt-2", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 pb-6 pt-2 border-t border-white/6", className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
