
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
    
    // Initialize hasValue based on whether propValue (controlled) or defaultValue (uncontrolled) has an initial truthy value.
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
      setHasValue(!!e.target.value); 
      if (onBlur) {
        onBlur(e);
      }
    };

    // Effect to sync hasValue with propValue for controlled components
    // This is important if the value is changed programmatically from outside (e.g., form.reset())
    React.useEffect(() => {
      // console.log(`AnimatedInput (${label}): propValue changed to:`, propValue); // Temporary debug log
      if (propValue !== undefined) { // Ensures this runs for controlled components
        const newHasValue = !!propValue;
        // console.log(`AnimatedInput (${label}): setting hasValue to:`, newHasValue); // Temporary debug log
        setHasValue(newHasValue);
      }
    }, [propValue, label]); // Added label to dep array for debugging only, can be removed.


    const isLabelFloating = isFocused || hasValue;

    return (
      <div className={cn("relative pt-4", containerClassName)}>
        <Label
          htmlFor={internalId}
          className={cn(
            "absolute left-3 transition-all duration-200 ease-in-out pointer-events-none",
            isFocused ? "text-primary" : "text-muted-foreground",
            isLabelFloating
              ? "top-0 text-xs" 
              : "top-1/2 -translate-y-1/2 text-base" 
          )}
        >
          {label}
        </Label>
        <Input
          id={internalId}
          ref={ref}
          type={type}
          className={cn(
            "h-10 pt-3 text-base", 
            "focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
            className
          )}
          onChange={handleInputChange}
          onFocus={handleFocusEvent}
          onBlur={handleBlurEvent}
          placeholder={isLabelFloating ? "" : " "} 
          value={propValue} 
          defaultValue={defaultValue}
          {...props}
        />
      </div>
    );
  }
);
AnimatedInput.displayName = "AnimatedInput";

export { AnimatedInput };
