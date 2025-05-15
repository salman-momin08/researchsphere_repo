
"use client";

import { useState, useEffect } from 'react';
import { cn } from "@/lib/utils"; // Added missing import

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
    let timeLeft = { total: 0, days: 0, hours: 0, minutes: 0, seconds: 0, isOverdue: false, hasTarget: true };

    if (difference > 0) {
      timeLeft = {
        ...timeLeft,
        total: difference,
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60),
      };
    } else {
      timeLeft.isOverdue = true;
    }
    return timeLeft;
  };

  const [timeLeft, setTimeLeft] = useState(() => calculateTimeLeft(targetDateISO));

  useEffect(() => {
    // Update timeLeft whenever targetDateISO changes
    setTimeLeft(calculateTimeLeft(targetDateISO));

    if (!targetDateISO || timeLeft.isOverdue) {
      if (timeLeft.isOverdue && timeLeft.hasTarget && onDeadline) {
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
  }, [targetDateISO, onDeadline, timeLeft.isOverdue, timeLeft.hasTarget]); // Added dependencies

  if (!timeLeft.hasTarget) {
    return <span className={className}>No deadline set.</span>;
  }

  if (timeLeft.isOverdue) {
    return <span className={cn(className, "text-destructive")}>Payment deadline has passed.</span>;
  }
  
  const format = (num: number) => num.toString().padStart(2, '0');

  return (
    <span className={cn("font-medium", className)}> {/* Added font-medium for better visibility */}
      {prefixText}
      {timeLeft.days > 0 && `${timeLeft.days}d `}
      {format(timeLeft.hours)}h {format(timeLeft.minutes)}m {format(timeLeft.seconds)}s
    </span>
  );
};

export default CountdownTimer;
