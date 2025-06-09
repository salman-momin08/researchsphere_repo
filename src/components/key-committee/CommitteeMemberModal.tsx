
"use client";

import React from 'react';
import Image from "next/image"; // Keep this for internal use by AvatarImage with local paths
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Building, Mail, Star, UserCircle } from "lucide-react";
import { getInitials } from '@/lib/utils';

interface CommitteeMemberForModal {
  id: string;
  name: string;
  title: string;
  affiliation: string;
  imageUrl?: string; // This will be the constructed path like /images/committee/file.png
  bio?: string;
  achievements?: string[];
  email?: string;
}

export interface CommitteeMemberModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  member: CommitteeMemberForModal | null;
}

const CommitteeMemberModalComponent = ({ isOpen, onOpenChange, member }: CommitteeMemberModalProps) => {
  if (!member) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="text-center sm:text-left">
          <div className="flex flex-col sm:flex-row items-center gap-4 mb-4">
            <Avatar className="h-24 w-24 sm:h-28 sm:w-28 border-2 border-primary">
              {member.imageUrl ? (
                <AvatarImage
                  src={member.imageUrl} // Use the passed imageUrl
                  alt={member.name}
                  className="aspect-square object-cover"
                />
              ) : null }
              <AvatarFallback className="text-3xl sm:text-4xl bg-muted">
                {getInitials(member.name) || <UserCircle size={60} />}
              </AvatarFallback>
            </Avatar>
            <div className="text-center sm:text-left">
              <DialogTitle className="text-xl sm:text-2xl font-bold">{member.name}</DialogTitle>
              <DialogDescription className="text-sm sm:text-base text-primary font-medium">{member.title}</DialogDescription>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1 flex items-center justify-center sm:justify-start">
                <Building className="h-4 w-4 mr-2 text-primary/80" />
                {member.affiliation}
              </p>
              {member.email && (
                 <a href={`mailto:${member.email}`} className="text-xs sm:text-sm text-muted-foreground hover:text-primary transition-colors mt-1 flex items-center justify-center sm:justify-start">
                    <Mail size={14} className="mr-2 text-primary/80" />
                    {member.email}
                  </a>
              )}
            </div>
          </div>
        </DialogHeader>

        <Separator className="my-4" />

        <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2 text-sm sm:text-base">
          {member.bio && (
            <div>
              <h4 className="font-semibold mb-1 text-foreground">Biography</h4>
              <p className="text-muted-foreground">{member.bio}</p>
            </div>
          )}

          {member.achievements && member.achievements.length > 0 && (
            <div>
              <h4 className="font-semibold mt-3 mb-1 text-foreground">Key Achievements & Experience</h4>
              <ul className="list-none space-y-1.5 text-muted-foreground">
                {member.achievements.map((achievement, index) => (
                  <li key={index} className="flex items-start">
                    <Star className="h-4 w-4 mr-2 mt-0.5 text-yellow-500 flex-shrink-0" />
                    <span>{achievement}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter className="mt-4">
         <Button onClick={() => onOpenChange(false)} className="w-full sm:w-auto text-sm sm:text-base" variant="outline">
            Close
        </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

CommitteeMemberModalComponent.displayName = 'CommitteeMemberModalComponent';

export default CommitteeMemberModalComponent;
