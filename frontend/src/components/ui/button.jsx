import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "./utils";

const buttonVariants = cva(
  "button-world inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl text-sm font-bold transition-all duration-300 disabled:pointer-events-none disabled:opacity-30 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 outline-hidden focus-visible:ring-2 focus-visible:ring-sky-500/40",
  {
    variants: {
      variant: {
        default:
          "button-world-primary bg-linear-to-br from-sky-500 to-blue-500 text-slate-700 shadow-[0_8px_32px_rgba(14, 165, 233,0.3)] hover:shadow-[0_12px_48px_rgba(14, 165, 233,0.5)] hover:-translate-y-1 hover:scale-[1.03] border border-slate-300",
        destructive:
          "bg-blue-500/10 border border-blue-500/30 text-blue-300 hover:bg-blue-500/20",
        outline:
          "button-world-secondary border border-slate-300/50 bg-white/4 text-sky-200 hover:bg-white/8 hover:border-sky-500/30 hover:-translate-y-0.5 backdrop-blur-md",
        secondary:
          "button-world-secondary bg-white/6 border border-slate-300/50 text-sky-100 hover:bg-white/10 hover:border-slate-300 backdrop-blur-xl",
        ghost:
          "button-world-ghost text-sky-300/60 hover:bg-white/5 hover:text-slate-700",
        link: "text-sky-400 underline-offset-4 hover:underline font-black uppercase tracking-widest text-[10px]",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm:  "h-8 px-4 text-xs",
        lg:  "h-12 px-7 text-base",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({ className, variant, size, asChild = false, ...props }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : "button"}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
