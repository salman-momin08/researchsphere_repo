
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
  ({ className, type, label, id, containerClassName, value: propValue, defaultValue, onChange, onFocus, onBlur, ...props }, ref) => {
    const internalId = id || React.useId();
    
    // Initialize hasValue based on defaultValue for uncontrolled, or propValue for controlled.
    // The useEffect below will further refine this for controlled components.
    const [hasValue, setHasValue] = React.useState(!!(propValue !== undefined ? propValue : defaultValue));
    const [isFocused, setIsFocused] = React.useState(false);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setHasValue(!!e.target.value);
      if (onChange) {
        onChange(e);
      }
    };

    const handleFocusEvent = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(true);
      if (onFocus) {
        onFocus(e);
      }
    };

    const handleBlurEvent = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false);
      // When blurring, the source of truth for emptiness is the current value of the input element itself.
      // This handles cases where the field might be cleared without triggering onChange (e.g., browser autofill clear).
      setHasValue(!!e.target.value); 
      if (onBlur) {
        onBlur(e);
      }
    };

    // Effect to sync hasValue with propValue for controlled components
    // This is important if the value is changed programmatically from outside (e.g., form.reset())
    React.useEffect(() => {
      if (propValue !== undefined) { // This check ensures it only runs for controlled components
        setHasValue(!!propValue);
      }
    }, [propValue]);


    const isLabelFloating = isFocused || hasValue;

    return (
      <div className={cn("relative pt-4", containerClassName)}>
        <Label
          htmlFor={internalId}
          className={cn(
            "absolute left-3 transition-all duration-200 ease-in-out pointer-events-none",
            // Set text color: primary if focused, otherwise muted-foreground
            isFocused ? "text-primary" : "text-muted-foreground",
            // Set position and font size based on floating state
            isLabelFloating
              ? "top-0 text-xs" // Floating state
              : "top-1/2 -translate-y-1/2 text-base" // Resting state (inside input)
          )}
        >
          {label}
        </Label>
        <Input
          id={internalId}
          ref={ref}
          type={type}
          className={cn(
            "h-10 pt-3 text-base", // Added pt-3 to ensure text input doesn't overlap with label when resting
            "focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1", // Thinner focus ring
            className
          )}
          onChange={handleInputChange}
          onFocus={handleFocusEvent}
          onBlur={handleBlurEvent}
          // Using a space as a placeholder can help with consistent height/baseline
          // when the label is not floating. It's important this doesn't evaluate to true for `hasValue`.
          placeholder={isLabelFloating ? "" : " "} 
          value={propValue} // Pass value for controlled components
          defaultValue={defaultValue} // Pass defaultValue for uncontrolled components
          {...props}
        />
      </div>
    );
  }
);
AnimatedInput.displayName = "AnimatedInput";

export { AnimatedInput };
