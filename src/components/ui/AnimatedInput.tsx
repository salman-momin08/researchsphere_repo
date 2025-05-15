
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
    // Use props.value or props.defaultValue to initialize hasValue state correctly
    const [hasValue, setHasValue] = React.useState(!!(props.value || props.defaultValue || ''));
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
      // Ensure hasValue reflects current input value on blur,
      // especially if component is uncontrolled and props.value isn't set.
      setHasValue(!!e.target.value);
      if (props.onBlur) {
        props.onBlur(e);
      }
    };

    // Determine if label should float based on focus or if the input has a value
    const isLabelFloating = isFocused || hasValue;

    return (
      <div className={cn("relative pt-4", containerClassName)}>
        <Label
          htmlFor={internalId}
          className={cn(
            "absolute left-3 transition-all duration-200 ease-in-out pointer-events-none",
            "text-muted-foreground",
            isLabelFloating
              ? "top-0 text-xs text-primary" // Floating state: above the input
              : "top-1/2 -translate-y-1/2 text-base" // Resting state: inside the input
          )}
        >
          {label}
        </Label>
        <Input
          id={internalId}
          ref={ref}
          type={type}
          className={cn(
            "h-10 pt-3 text-base", // Ensure padding-top for label space when it's inside
            // Custom focus styling for a thinner ring
            "focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
            className
          )}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          // Using a space as a placeholder can help with consistent height/baseline
          // when the label is not floating, but it's not strictly necessary for the floating label logic
          placeholder={isLabelFloating ? "" : " "} 
          {...props}
        />
      </div>
    );
  }
);
AnimatedInput.displayName = "AnimatedInput";

export { AnimatedInput };
