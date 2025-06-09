
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { AnimatedInput } from "@/components/ui/AnimatedInput";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Mail, Send, Loader2, CheckCircle, UserCircle, Phone, Briefcase } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Image from "next/image";
import { getInitials } from "@/lib/utils"; // Import the getInitials function

const contactFormSchema = z.object({
  fullName: z.string().min(3, { message: "Full name must be at least 3 characters." }),
  email: z.string().email({ message: "Please enter a valid email address." }),
  subject: z.string().min(1, { message: "Subject is required." }),
  message: z.string().min(10, { message: "Message must be at least 10 characters." }),
});

type ContactFormValues = z.infer<typeof contactFormSchema>;

interface ContactPerson {
  id: string;
  name: string;
  designation: string;
  email: string;
  phone?: string;
  imageUrl?: string;
  dataAiHint?: string;
}

const contactPersons: ContactPerson[] = [
  {
    id: "1",
    name: "Dr. Eleanor Vance",
    designation: "General Inquiries Lead",
    email: "support@researchsphere.com",
    phone: "+1-800-555-0100",
    imageUrl: "https://picsum.photos/seed/contact1/100/100.png",
    dataAiHint: "support professional"
  },
  {
    id: "2",
    name: "Mr. Samuel Finch",
    designation: "Technical Support Head",
    email: "tech@researchsphere.com",
    phone: "+1-800-555-0101",
    imageUrl: "https://picsum.photos/seed/contact2/100/100.png",
    dataAiHint: "tech expert"
  },
  {
    id: "3",
    name: "Ms. Clara Dubois",
    designation: "Partnership Coordinator",
    email: "partners@researchsphere.com",
    imageUrl: "https://picsum.photos/seed/contact3/100/100.png",
    dataAiHint: "business professional"
  },
  {
    id: "4",
    name: "Dr. Evelyn Reed", 
    designation: "Conference Chair Liaison",
    email: "evelyn.reed@researchsphere.com",
    imageUrl: "https://picsum.photos/seed/contact4/100/100.png",
    dataAiHint: "academic leader"
  }
];


export default function ContactUsPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      fullName: "",
      email: "",
      subject: "",
      message: "",
    },
  });

  const onSubmit = async (data: ContactFormValues) => {
    setIsLoading(true);
    setIsSuccess(false);

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500));

    setIsLoading(false);
    setIsSuccess(true);
    toast({
      title: "Message Sent!",
      description: "Thank you for contacting us. We'll get back to you soon.",
    });
    form.reset();
  };

  return (
    <div className="min-h-[calc(100vh-8rem)] bg-secondary py-12 md:py-20 px-4 sm:px-6 lg:px-8">
      <div className="container mx-auto">
        <header className="text-center mb-12 md:mb-16">
            <Mail size={48} strokeWidth={1.5} className="mx-auto mb-4 md:mb-6 text-primary" />
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-3 sm:mb-4">
            Get in <span className="text-primary">Touch</span>
          </h1>
          <p className="text-md sm:text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Have questions or need support? Reach out to our team or fill out the contact form below.
          </p>
        </header>

        <section className="mb-12 md:mb-16">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-semibold text-center mb-8 md:mb-10">Meet Our Support Team</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
            {contactPersons.map((person) => (
              <Card key={person.id} className="shadow-lg hover:shadow-xl transition-shadow duration-300 flex flex-col">
                <CardHeader className="items-center text-center">
                  <Avatar className="h-20 w-20 sm:h-24 sm:w-24 mb-4 border-2 border-primary">
                    {person.imageUrl ? (
                      <AvatarImage
                        src={person.imageUrl}
                        alt={person.name}
                        // width={100} // Not needed for AvatarImage
                        // height={100} // Not needed for AvatarImage
                        className="aspect-square object-cover"
                        // data-ai-hint={person.dataAiHint || "professional portrait"} // Data AI hint is already part of picsum URL logic or for actual generation
                      />
                    ) : null }
                    <AvatarFallback className="text-2xl sm:text-3xl bg-muted text-primary-foreground">
                      {getInitials(person.name)}
                    </AvatarFallback>
                  </Avatar>
                  <CardTitle className="text-lg sm:text-xl">{person.name}</CardTitle>
                  <p className="text-xs sm:text-sm text-primary font-medium flex items-center justify-center">
                    <Briefcase className="mr-2 h-4 w-4 sm:h-5 sm:w-5" /> {person.designation}
                  </p>
                </CardHeader>
                <CardContent className="flex-grow space-y-2 text-xs sm:text-sm text-muted-foreground text-center">
                  <a href={`mailto:${person.email}`} className="flex items-center justify-center hover:text-primary transition-colors">
                    <Mail className="mr-2 h-4 w-4 sm:h-5 sm:w-5 text-primary/80" />
                    <span>{person.email}</span>
                  </a>
                  {person.phone && (
                    <a href={`tel:${person.phone}`} className="flex items-center justify-center hover:text-primary transition-colors">
                      <Phone className="mr-2 h-4 w-4 sm:h-5 sm:w-5 text-primary/80" />
                      <span>{person.phone}</span>
                    </a>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <Card className="w-full max-w-lg mx-auto shadow-xl">
          <CardHeader className="text-center">
            <CardTitle className="text-xl sm:text-2xl font-bold tracking-tight">Send Us a Message</CardTitle>
            <CardDescription className="text-sm sm:text-base">
              Fill out the form and we&apos;ll get back to you as soon as possible.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 sm:space-y-6">
            {isSuccess ? (
              <Alert variant="default" className="border-green-500 bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700">
                <CheckCircle className="h-4 w-4 !text-green-700 dark:!text-green-400" />
                <AlertTitle>Message Sent Successfully!</AlertTitle>
                <AlertDescription className="!text-green-700 dark:!text-green-400">
                  Thank you for reaching out. We will get back to you as soon as possible.
                </AlertDescription>
              </Alert>
            ) : (
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-2">
                <AnimatedInput
                  label="Full Name *"
                  id="fullName"
                  {...form.register("fullName")}
                  disabled={isLoading}
                />
                {form.formState.errors.fullName && (
                  <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.fullName.message}</p>
                )}

                <AnimatedInput
                  label="Email Address *"
                  id="email"
                  type="email"
                  {...form.register("email")}
                  disabled={isLoading}
                />
                {form.formState.errors.email && (
                  <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.email.message}</p>
                )}

                <AnimatedInput
                  label="Subject *"
                  id="subject"
                  {...form.register("subject")}
                  disabled={isLoading}
                />
                {form.formState.errors.subject && (
                  <p className="text-sm text-destructive mt-1 px-1">{form.formState.errors.subject.message}</p>
                )}

                <div className="pt-2">
                  <Label htmlFor="message" className={form.formState.errors.message ? "text-destructive" : ""}>Message *</Label>
                  <Textarea
                    id="message"
                    placeholder="Your message here..."
                    rows={5}
                    {...form.register("message")}
                    disabled={isLoading}
                    className="mt-1 text-sm sm:text-base"
                  />
                  {form.formState.errors.message && (
                    <p className="text-sm text-destructive mt-1">{form.formState.errors.message.message}</p>
                  )}
                </div>

                <Button type="submit" className="w-full mt-4 text-sm sm:text-base" disabled={isLoading}>
                  {isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  {isLoading ? "Sending..." : "Send Message"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

