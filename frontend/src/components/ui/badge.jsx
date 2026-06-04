import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "./utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-[0.7rem] font-700 w-fit whitespace-nowrap shrink-0 uppercase tracking-wider gap-1 transition-colors overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[#06d6c7]/15 text-[#06d6c7]",
        secondary:
          "border-slate-300/50 bg-white/6 text-slate-300",
        destructive:
          "border-transparent bg-blue-500/15 text-blue-300",
        outline:
          "border-slate-300/50 text-slate-400",
        cyan:
          "border-transparent bg-cyan-500/15 text-cyan-300",
        amber:
          "border-transparent bg-amber-500/15 text-amber-300",
        emerald:
          "border-transparent bg-emerald-500/15 text-emerald-300",
        sky:
          "border-transparent bg-sky-500/15 text-sky-300",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({ className, variant, asChild = false, ...props }) {
  const Comp = asChild ? Slot : "span";
  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
