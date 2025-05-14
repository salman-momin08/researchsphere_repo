
"use client";

import { useState, useEffect } from 'react';

interface CountdownTimerProps {
  targetDateISO: string | null | undefined;
  onDeadline?: () => void;
  className?: string;
  prefixText?: string;
}

const CountdownTimer: React.FC<CountdownTimerProps> = ({ targetDateISO, onDeadline, className, prefixText = "Time left: " }) => {
  const calculateTimeLeft = () => {
    if (!targetDateISO) {
      return { total: 0, days: 0, hours: 0, minutes: 0, seconds: 0, isOverdue: true };
    }
    const difference = +new Date(targetDateISO) - +new Date();
    let timeLeft = { total: 0, days: 0, hours: 0, minutes: 0, seconds: 0, isOverdue: false };

    if (difference > 0) {
      timeLeft = {
        total: difference,
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60),
        isOverdue: false,
      };
    } else {
      timeLeft.isOverdue = true;
    }
    return timeLeft;
  };

  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft());

  useEffect(() => {
    if (!targetDateISO || timeLeft.isOverdue) {
      if (timeLeft.isOverdue && onDeadline) onDeadline();
      return;
    }

    const timer = setTimeout(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);

    return () => clearTimeout(timer);
  }); // No dependency array to re-run every second

  if (!targetDateISO) {
    return <span className={className}>No deadline set.</span>;
  }

  if (timeLeft.isOverdue) {
    return <span className={cn(className, "text-destructive")}>Payment deadline has passed.</span>;
  }
  
  const format = (num: number) => num.toString().padStart(2, '0');

  return (
    <span className={className}>
      {prefixText}
      {timeLeft.days > 0 && `${timeLeft.days}d `}
      {format(timeLeft.hours)}h {format(timeLeft.minutes)}m {format(timeLeft.seconds)}s
    </span>
  );
};

// Helper for conditional class names, if not already available
const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' ');

export default CountdownTimer;
