
"use client";

import { useState, useEffect } from 'react';
import { cn } from "@/lib/utils"; 

interface CountdownTimerProps {
  targetDateISO: string | null | undefined;
  onDeadline?: () => void;
  className?: string;
  prefixText?: string;
}

const CountdownTimer: React.FC<CountdownTimerProps> = ({ targetDateISO, onDeadline, className, prefixText = "Time left: " }) => {
  const calculateTimeLeft = (target: string | null | undefined) => {
    if (!target) {
      return { total: 0, days: 0, hours: 0, minutes: 0, seconds: 0, isOverdue: true, hasTarget: false };
    }
    const difference = +new Date(target) - +new Date();
    let timeLeftValues = { total: 0, days: 0, hours: 0, minutes: 0, seconds: 0, isOverdue: false, hasTarget: true };

    if (difference > 0) {
      timeLeftValues = {
        ...timeLeftValues,
        total: difference,
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60),
      };
    } else {
      timeLeftValues.isOverdue = true;
    }
    return timeLeftValues;
  };

  const [timeLeft, setTimeLeft] = useState(() => calculateTimeLeft(targetDateISO));

  useEffect(() => {
    const initialTimeLeft = calculateTimeLeft(targetDateISO);
    setTimeLeft(initialTimeLeft);

    if (!targetDateISO || initialTimeLeft.isOverdue) {
      if (initialTimeLeft.isOverdue && initialTimeLeft.hasTarget && onDeadline) {
        onDeadline();
      }
      return; // No timer needed if no target or already overdue
    }

    const timer = setInterval(() => {
      setTimeLeft(prevTimeLeft => {
        const newTimeLeft = calculateTimeLeft(targetDateISO);
        if (newTimeLeft.isOverdue && !prevTimeLeft.isOverdue && onDeadline) {
          onDeadline();
        }
        return newTimeLeft;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [targetDateISO, onDeadline]);

  if (!timeLeft.hasTarget) {
    return <span className={className}>No deadline set.</span>;
  }

  if (timeLeft.isOverdue) {
    return <span className={cn(className, "text-destructive")}>Payment deadline has passed.</span>;
  }
  
  const format = (num: number) => num.toString().padStart(2, '0');

  return (
    <span className={cn("font-medium", className)}>
      {prefixText}
      {timeLeft.days > 0 && `${timeLeft.days}d `}
      {format(timeLeft.hours)}h {format(timeLeft.minutes)}m {format(timeLeft.seconds)}s
    </span>
  );
};

export default CountdownTimer;
