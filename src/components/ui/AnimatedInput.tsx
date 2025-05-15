
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Input, type InputProps } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AnimatedInputProps extends InputProps {
  label: string;
  containerClassName?: string;
}

const AnimatedInput = React.forwardRef<HTMLInputElement, AnimatedInputProps>(
  ({ className, type, label, id, containerClassName, ...props }, ref) => {
    const internalId = id || React.useId();
    const [hasValue, setHasValue] = React.useState(!!props.value || !!props.defaultValue);
    const [isFocused, setIsFocused] = React.useState(false);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setHasValue(!!e.target.value);
      if (props.onChange) {
        props.onChange(e);
      }
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(true);
      if (props.onFocus) {
        props.onFocus(e);
      }
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false);
      if (props.onBlur) {
        props.onBlur(e);
      }
    };

    const isLabelFloating = isFocused || hasValue;

    return (
      <div className={cn("relative pt-4", containerClassName)}>
        <Label
          htmlFor={internalId}
          className={cn(
            "absolute left-3 transition-all duration-200 ease-in-out pointer-events-none",
            "text-muted-foreground",
            isLabelFloating
              ? "top-0 text-xs text-primary" // Floating state
              : "top-1/2 -translate-y-1/2 text-base" // Resting state (placeholder-like)
          )}
        >
          {label}
        </Label>
        <Input
          id={internalId}
          ref={ref}
          type={type}
          className={cn(
            "h-10 pt-3 text-base", // Adjusted padding for label space
            className
          )}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          // Use a transparent placeholder to ensure label visibility logic works, or remove placeholder prop
          placeholder={isLabelFloating ? "" : " "} 
          {...props}
        />
      </div>
    );
  }
);
AnimatedInput.displayName = "AnimatedInput";

export { AnimatedInput };
