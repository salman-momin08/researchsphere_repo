
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Building, UserCircle, Mail, Star, Briefcase } from "lucide-react";
import Image from "next/image";
import dynamic from 'next/dynamic';
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { getInitials } from "@/lib/utils";

interface CommitteeMember {
  id: string;
  name: string;
  title: string;
  affiliation: string;
  imageFileName?: string; // Changed from imageUrl to imageFileName
  bio?: string;
  achievements?: string[];
  email?: string;
}

const committeeMembers: CommitteeMember[] = [
  {
    id: "1",
    name: "Dr. Evelyn Reed",
    title: "Conference Chair",
    affiliation: "Institute of Advanced Technology",
    imageFileName: "dr_evelyn_reed.png",
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
    imageFileName: "prof_samuel_green.png",
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
    imageFileName: "dr_olivia_chen.png",
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
    imageFileName: "dr_marcus_bellwether.png",
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
    imageFileName: "prof_anya_sharma.png",
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
    imageFileName: "dr_kenji_tanaka.png",
    bio: "Dr. Tanaka is instrumental in fostering international collaborations and ensuring diverse global participation in academic events.",
    achievements: [
      "Established partnerships with over 25 international institutions.",
      "Increased international participation in flagship conferences by 40%.",
      "Expert in cross-cultural communication in academic settings."
    ],
    email: "kenji.tanaka@researchsphere.com"
  },
];

const CommitteeMemberModal = dynamic(() => import('@/components/key-committee/CommitteeMemberModal'), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center"><LoadingSpinner size={32} /></div>,
});


export default function KeyCommitteePage() {
  const [selectedMember, setSelectedMember] = useState<CommitteeMember | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleCardClick = (member: CommitteeMember) => {
    // Construct imageUrl for the modal
    const memberForModal = {
      ...member,
      imageUrl: member.imageFileName ? `/images/committee/${member.imageFileName}` : undefined
    };
    setSelectedMember(memberForModal as any); // Cast needed because modal expects imageUrl
    setIsModalOpen(true);
  };

  return (
    <>
      <div className="bg-secondary">
        <div className="container mx-auto py-12 md:py-20 px-4 sm:px-6 lg:px-8">
          <header className="text-center mb-12 md:mb-16">
            <Briefcase size={48} strokeWidth={1.5} className="mx-auto mb-4 md:mb-6 text-primary" />
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-3 sm:mb-4">
              Key <span className="text-primary">Committee</span>
            </h1>
            <p className="text-md sm:text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
              Meet the dedicated individuals organizing and overseeing ResearchSphere's academic endeavors. Click on a member to learn more.
            </p>
          </header>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {committeeMembers.map((member) => (
              <Card
                key={member.id}
                className="shadow-lg hover:shadow-xl transition-shadow duration-300 flex flex-col cursor-pointer group"
                onClick={() => handleCardClick(member)}
              >
                <CardHeader className="items-center text-center">
                  <Avatar className="h-20 w-20 sm:h-24 sm:w-24 mb-4 border-2 border-primary group-hover:border-primary/70 transition-colors">
                    {member.imageFileName ? (
                    <AvatarImage
                      src={`/images/committee/${member.imageFileName}`}
                      alt={member.name}
                      className="aspect-square object-cover"
                    />
                    ) : null }
                    <AvatarFallback className="text-2xl sm:text-3xl bg-muted text-primary-foreground">
                      {getInitials(member.name)}
                    </AvatarFallback>
                  </Avatar>
                  <CardTitle className="text-lg sm:text-xl group-hover:text-primary transition-colors">{member.name}</CardTitle>
                  <CardDescription className="text-xs sm:text-sm text-primary font-medium group-hover:text-primary/80 transition-colors">{member.title}</CardDescription>
                </CardHeader>
                <CardContent className="flex-grow">
                  <div className="flex items-center text-xs sm:text-sm text-muted-foreground mb-2 justify-center">
                    <Building className="h-4 w-4 mr-2 text-primary/80" />
                    <span>{member.affiliation}</span>
                  </div>
                  {member.bio && (
                    <p className="text-xs sm:text-sm text-muted-foreground mt-3 pt-3 border-t border-border line-clamp-3">
                      {member.bio}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
      {isModalOpen && selectedMember && <CommitteeMemberModal isOpen={isModalOpen} onOpenChange={setIsModalOpen} member={selectedMember as any} />}
    </>
  );
}

