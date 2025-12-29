import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-12 w-full rounded-[16px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] px-4 py-3 text-base text-[#F3F1FF] placeholder:text-[#8B86A3] backdrop-blur-lg shadow-[0_10px_30px_rgba(0,0,0,0.35)] ring-offset-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(255,79,183,0.55)] focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
