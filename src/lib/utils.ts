import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const getInitials = (name: string): string => {
  if (!name || typeof name !== 'string') return "";
  const titles = ["Dr.", "Prof.", "Mr.", "Ms.", "Mrs."];
  let nameWithoutTitle = name;
  for (const title of titles) {
    if (nameWithoutTitle.startsWith(title + " ")) {
      nameWithoutTitle = nameWithoutTitle.substring(title.length + 1).trim();
      break;
    }
  }

  const nameParts = nameWithoutTitle.split(" ").filter(Boolean);
  if (nameParts.length === 0) return "";
  
  if (nameParts.length === 1) {
    return nameParts[0].substring(0, 2).toUpperCase();
  }
  
  // First letter of the first significant name part, and first letter of the last significant name part.
  return (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase();
};
