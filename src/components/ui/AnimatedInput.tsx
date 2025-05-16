
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
      setHasValue(!!e.target.value); 
      if (onBlur) {
        onBlur(e);
      }
    };

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
));
AnimatedInput.displayName = "AnimatedInput";

export { AnimatedInput };
