
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Building, Briefcase, UserCircle } from "lucide-react";
import Image from "next/image";

interface CommitteeMember {
  id: string;
  name: string;
  title: string;
  affiliation: string;
  imageUrl?: string;
  bio?: string;
  dataAiHint?: string;
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
  },
  {
    id: "2",
    name: "Prof. Samuel Green",
    title: "Program Chair",
    affiliation: "University of Global Studies",
    imageUrl: "https://picsum.photos/seed/samuel/100/100",
    dataAiHint: "professor man",
    bio: "Professor Green's research focuses on sustainable development and global collaboration in academia. He is passionate about fostering interdisciplinary research.",
  },
  {
    id: "3",
    name: "Dr. Olivia Chen",
    title: "Technical Program Committee Lead",
    affiliation: "Innovatech Research Labs",
    imageUrl: "https://picsum.photos/seed/olivia/100/100",
    dataAiHint: "researcher woman",
    bio: "Dr. Chen specializes in data science and machine learning. She has extensive experience in organizing technical programs for academic events.",
  },
  {
    id: "4",
    name: "Dr. Marcus Bellwether",
    title: "Publications Chair",
    affiliation: "Veridian Dynamics Publishing",
    // No image, will use fallback
    dataAiHint: "editor man",
    bio: "Dr. Bellwether has overseen the publication process for numerous high-impact journals and conference proceedings.",
  },
   {
    id: "5",
    name: "Prof. Anya Sharma",
    title: "Workshop Coordinator",
    affiliation: "Center for Collaborative Research",
    imageUrl: "https://picsum.photos/seed/anya/100/100",
    dataAiHint: "academic woman",
    bio: "Professor Sharma excels at organizing engaging and productive workshops that bridge the gap between theory and practice.",
  },
  {
    id: "6",
    name: "Dr. Kenji Tanaka",
    title: "International Liaison",
    affiliation: "Global Research Network",
    imageUrl: "https://picsum.photos/seed/kenji/100/100",
    dataAiHint: "professional man",
    bio: "Dr. Tanaka is instrumental in fostering international collaborations and ensuring diverse global participation in academic events.",
  },
];

export default function KeyCommitteePage() {
  return (
    <div className="bg-secondary">
      <div className="container py-12 md:py-20">
        <header className="text-center mb-12 md:mb-16">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Key <span className="text-primary">Committee</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Meet the dedicated individuals organizing and overseeing ResearchSphere's academic endeavors.
          </p>
        </header>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {committeeMembers.map((member) => (
            <Card key={member.id} className="shadow-lg hover:shadow-xl transition-shadow duration-300 flex flex-col">
              <CardHeader className="items-center text-center">
                <Avatar className="h-24 w-24 mb-4 border-2 border-primary">
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
                <CardTitle className="text-xl">{member.name}</CardTitle>
                <p className="text-sm text-primary font-medium">{member.title}</p>
              </CardHeader>
              <CardContent className="flex-grow">
                <div className="flex items-center text-sm text-muted-foreground mb-2">
                  <Building className="h-4 w-4 mr-2 text-primary/80" />
                  <span>{member.affiliation}</span>
                </div>
                {member.bio && (
                  <p className="text-sm text-muted-foreground mt-3 pt-3 border-t border-border">
                    {member.bio}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
