
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Building, UserCircle, Mail, Star, Briefcase } from "lucide-react";
import Image from "next/image";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";

interface CommitteeMember {
  id: string;
  name: string;
  title: string;
  affiliation: string;
  imageUrl?: string;
  dataAiHint?: string;
  bio?: string;
  achievements?: string[]; // New field for detailed achievements/experience
  email?: string; // Optional email for committee member
}

const committeeMembers: CommitteeMember[] = [
  {
    id: "1",
    name: "Dr. Evelyn Reed",
    title: "Conference Chair",
    affiliation: "Institute of Advanced Technology",
    imageUrl: "https://picsum.photos/seed/evelyn/100/100",
    dataAiHint: "scientist woman",
    bio: "Dr. Reed is a leading expert in artificial intelligence and its applications in scientific research. She has published numerous papers and chaired several international conferences.",
    achievements: [
      "Pioneered novel deep learning architectures for scientific discovery.",
      "Recipient of the Innovator of the Year Award 2023.",
      "Authored over 50 peer-reviewed publications.",
      "Successfully mentored 20+ PhD students."
    ],
    email: "evelyn.reed@researchsphere.com"
  },
  {
    id: "2",
    name: "Prof. Samuel Green",
    title: "Program Chair",
    affiliation: "University of Global Studies",
    imageUrl: "https://picsum.photos/seed/samuel/100/100",
    dataAiHint: "professor man",
    bio: "Professor Green's research focuses on sustainable development and global collaboration in academia. He is passionate about fostering interdisciplinary research.",
    achievements: [
      "Developed key frameworks for international research collaboration.",
      "Keynote speaker at 15+ international sustainability conferences.",
      "Secured major funding grants for environmental research projects."
    ],
    email: "samuel.green@researchsphere.com"
  },
  {
    id: "3",
    name: "Dr. Olivia Chen",
    title: "Technical Program Committee Lead",
    affiliation: "Innovatech Research Labs",
    imageUrl: "https://picsum.photos/seed/olivia/100/100",
    dataAiHint: "researcher woman",
    bio: "Dr. Chen specializes in data science and machine learning. She has extensive experience in organizing technical programs for academic events.",
    achievements: [
      "Lead organizer for the TPC of three major AI conferences.",
      "Published seminal work on ethical AI in big data.",
      "Awarded 'Top 40 Under 40' in Technology."
    ],
    email: "olivia.chen@researchsphere.com"
  },
  {
    id: "4",
    name: "Dr. Marcus Bellwether",
    title: "Publications Chair",
    affiliation: "Veridian Dynamics Publishing",
    // No image, will use fallback
    dataAiHint: "editor man",
    bio: "Dr. Bellwether has overseen the publication process for numerous high-impact journals and conference proceedings.",
    achievements: [
      "Editor-in-Chief for the 'Journal of Applied Research'.",
      "Streamlined publication workflows, reducing review times by 20%.",
      "Champion for open access publishing initiatives."
    ],
    email: "marcus.b@researchsphere.com"
  },
   {
    id: "5",
    name: "Prof. Anya Sharma",
    title: "Workshop Coordinator",
    affiliation: "Center for Collaborative Research",
    imageUrl: "https://picsum.photos/seed/anya/100/100",
    dataAiHint: "academic woman",
    bio: "Professor Sharma excels at organizing engaging and productive workshops that bridge the gap between theory and practice.",
    achievements: [
      "Organized 30+ successful international workshops.",
      "Known for innovative workshop formats promoting active participation.",
      "Recipient of the 'Excellence in Academic Service' award."
    ],
    email: "anya.sharma@researchsphere.com"
  },
  {
    id: "6",
    name: "Dr. Kenji Tanaka",
    title: "International Liaison",
    affiliation: "Global Research Network",
    imageUrl: "https://picsum.photos/seed/kenji/100/100",
    dataAiHint: "professional man",
    bio: "Dr. Tanaka is instrumental in fostering international collaborations and ensuring diverse global participation in academic events.",
    achievements: [
      "Established partnerships with over 25 international institutions.",
      "Increased international participation in flagship conferences by 40%.",
      "Expert in cross-cultural communication in academic settings."
    ],
    email: "kenji.tanaka@researchsphere.com"
  },
];

interface CommitteeMemberModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  member: CommitteeMember | null;
}

function CommitteeMemberModal({ isOpen, onOpenChange, member }: CommitteeMemberModalProps) {
  if (!member) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="text-center sm:text-left">
          <div className="flex flex-col sm:flex-row items-center gap-4 mb-4">
            <Avatar className="h-28 w-28 border-2 border-primary">
              {member.imageUrl ? (
                <Image
                  src={member.imageUrl}
                  alt={member.name}
                  width={112}
                  height={112}
                  className="aspect-square object-cover"
                  data-ai-hint={member.dataAiHint}
                />
              ) : (
                <AvatarFallback className="text-4xl bg-muted">
                  <UserCircle size={60} />
                </AvatarFallback>
              )}
            </Avatar>
            <div className="text-center sm:text-left">
              <DialogTitle className="text-2xl font-bold">{member.name}</DialogTitle>
              <DialogDescription className="text-primary font-medium">{member.title}</DialogDescription>
              <p className="text-sm text-muted-foreground mt-1 flex items-center justify-center sm:justify-start">
                <Building className="h-4 w-4 mr-2 text-primary/80" />
                {member.affiliation}
              </p>
              {member.email && (
                 <a href={`mailto:${member.email}`} className="text-sm text-muted-foreground hover:text-primary transition-colors mt-1 flex items-center justify-center sm:justify-start">
                    <Mail size={14} className="mr-2 text-primary/80" />
                    {member.email}
                  </a>
              )}
            </div>
          </div>
        </DialogHeader>
        
        <Separator className="my-4" />

        <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2">
          {member.bio && (
            <div>
              <h4 className="font-semibold mb-1 text-foreground">Biography</h4>
              <p className="text-sm text-muted-foreground">{member.bio}</p>
            </div>
          )}

          {member.achievements && member.achievements.length > 0 && (
            <div>
              <h4 className="font-semibold mt-3 mb-1 text-foreground">Key Achievements & Experience</h4>
              <ul className="list-none space-y-1.5 text-sm text-muted-foreground">
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
         <Button onClick={() => onOpenChange(false)} className="mt-4 w-full sm:w-auto sm:ml-auto" variant="outline">
            Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}


export default function KeyCommitteePage() {
  const [selectedMember, setSelectedMember] = useState<CommitteeMember | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleCardClick = (member: CommitteeMember) => {
    setSelectedMember(member);
    setIsModalOpen(true);
  };

  return (
    <>
      <div className="bg-secondary">
        <div className="container py-12 md:py-20">
          <header className="text-center mb-12 md:mb-16">
            <Briefcase size={64} strokeWidth={1.5} className="mx-auto mb-6 text-primary" />
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
              Key <span className="text-primary">Committee</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
              Meet the dedicated individuals organizing and overseeing ResearchSphere's academic endeavors. Click on a member to learn more.
            </p>
          </header>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {committeeMembers.map((member) => (
              <Card 
                key={member.id} 
                className="shadow-lg hover:shadow-xl transition-shadow duration-300 flex flex-col cursor-pointer group"
                onClick={() => handleCardClick(member)}
              >
                <CardHeader className="items-center text-center">
                  <Avatar className="h-24 w-24 mb-4 border-2 border-primary group-hover:border-primary/70 transition-colors">
                    {member.imageUrl ? (
                    <Image 
                      src={member.imageUrl} 
                      alt={member.name} 
                      width={100} 
                      height={100} 
                      className="aspect-square object-cover"
                      data-ai-hint={member.dataAiHint}
                    />
                    ) : (
                    <AvatarFallback className="text-3xl bg-muted">
                      <UserCircle size={48} />
                    </AvatarFallback>
                    )}
                  </Avatar>
                  <CardTitle className="text-xl group-hover:text-primary transition-colors">{member.name}</CardTitle>
                  <CardDescription className="text-sm text-primary font-medium group-hover:text-primary/80 transition-colors">{member.title}</CardDescription>
                </CardHeader>
                <CardContent className="flex-grow">
                  <div className="flex items-center text-sm text-muted-foreground mb-2 justify-center">
                    <Building className="h-4 w-4 mr-2 text-primary/80" />
                    <span>{member.affiliation}</span>
                  </div>
                  {member.bio && (
                    <p className="text-sm text-muted-foreground mt-3 pt-3 border-t border-border line-clamp-3">
                      {member.bio}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
      <CommitteeMemberModal isOpen={isModalOpen} onOpenChange={setIsModalOpen} member={selectedMember} />
    </>
  );
}
