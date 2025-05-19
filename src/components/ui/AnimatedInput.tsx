
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Input, type InputProps } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AnimatedInputProps extends InputProps {
  label: string;
  containerClassName?: string;
}

const AnimatedInput = React.memo(React.forwardRef<HTMLInputElement, AnimatedInputProps>(
  ({ className, type, label, id, containerClassName, value: propValue, defaultValue, onChange, onFocus, onBlur, ...props }, ref) => {
    const internalId = id || React.useId();
    
    // Determine initial hasValue based on propValue or defaultValue
    const initialHasValue = !!(propValue !== undefined ? propValue : defaultValue);
    const [hasValue, setHasValue] = React.useState(initialHasValue);
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
      // Update hasValue based on the current actual value in the input field
      setHasValue(!!e.target.value); 
      if (onBlur) {
        onBlur(e);
      }
    };

    // Effect to sync `hasValue` if `propValue` changes from outside (e.g., form reset)
    React.useEffect(() => {
      if (propValue !== undefined) {
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
            isFocused ? "text-primary" : "text-muted-foreground", // Label color based on focus
            isLabelFloating
              ? "top-0 text-xs" // Floated state
              : "top-1/2 -translate-y-1/2 text-base" // Resting state inside input
          )}
        >
          {label}
        </Label>
        <Input
          id={internalId}
          ref={ref}
          type={type}
          className={cn(
            "h-10 pt-3 text-base", // Increased padding-top to accommodate resting label
            "focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1", // Thinner focus ring
            className
          )}
          onChange={handleInputChange}
          onFocus={handleFocusEvent}
          onBlur={handleBlurEvent}
          placeholder={isLabelFloating ? "" : " "} // Show placeholder only when label is not floating (trick to make space)
          value={propValue} 
          defaultValue={defaultValue}
          {...props}
        />
      </div>
    );
  }
));
AnimatedInput.displayName = "AnimatedInput";

export { AnimatedInput };
