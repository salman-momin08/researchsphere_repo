
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Mail, Send, Loader2, CheckCircle, UserCircle, Phone, Briefcase } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Image from "next/image";

const contactFormSchema = z.object({
  fullName: z.string().min(3, { message: "Full name must be at least 3 characters." }),
  email: z.string().email({ message: "Please enter a valid email address." }),
  subject: z.string().optional(),
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
    imageUrl: "https://picsum.photos/seed/eleanor/100/100",
    dataAiHint: "support woman"
  },
  {
    id: "2",
    name: "Mr. Samuel Finch",
    designation: "Technical Support Head",
    email: "tech@researchsphere.com",
    phone: "+1-800-555-0101",
    imageUrl: "https://picsum.photos/seed/samuelfinch/100/100",
    dataAiHint: "support man"
  },
  {
    id: "3",
    name: "Ms. Clara Dubois",
    designation: "Partnership Coordinator",
    email: "partners@researchsphere.com",
    // No phone
    imageUrl: "https://picsum.photos/seed/clara/100/100",
    dataAiHint: "coordinator woman"
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
    console.log("Contact form data:", data); // In a real app, send this data to a backend

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
    <div className="min-h-[calc(100vh-8rem)] bg-secondary py-12 px-4 sm:px-6 lg:px-8">
      <div className="container mx-auto">
        <header className="text-center mb-12 md:mb-16">
            <Mail size={64} strokeWidth={1.5} className="mx-auto mb-6 text-primary" />
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Get in <span className="text-primary">Touch</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Have questions or need support? Reach out to our team or fill out the contact form below.
          </p>
        </header>

        {/* Contact Persons Section */}
        <section className="mb-12 md:mb-16">
          <h2 className="text-3xl font-semibold text-center mb-10">Meet Our Support Team</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {contactPersons.map((person) => (
              <Card key={person.id} className="shadow-lg hover:shadow-xl transition-shadow duration-300 flex flex-col">
                <CardHeader className="items-center text-center">
                  <Avatar className="h-24 w-24 mb-4 border-2 border-primary">
                    {person.imageUrl ? (
                      <Image 
                        src={person.imageUrl} 
                        alt={person.name} 
                        width={100} 
                        height={100} 
                        className="aspect-square object-cover"
                        data-ai-hint={person.dataAiHint}
                      />
                    ) : (
                      <AvatarFallback className="text-3xl bg-muted">
                        <UserCircle size={48} />
                      </AvatarFallback>
                    )}
                  </Avatar>
                  <CardTitle className="text-xl">{person.name}</CardTitle>
                  <p className="text-sm text-primary font-medium flex items-center">
                    <Briefcase size={16} className="mr-2" /> {person.designation}
                  </p>
                </CardHeader>
                <CardContent className="flex-grow space-y-2 text-sm text-muted-foreground text-center">
                  <a href={`mailto:${person.email}`} className="flex items-center justify-center hover:text-primary transition-colors">
                    <Mail size={16} className="mr-2 text-primary/80" />
                    <span>{person.email}</span>
                  </a>
                  {person.phone && (
                    <a href={`tel:${person.phone}`} className="flex items-center justify-center hover:text-primary transition-colors">
                      <Phone size={16} className="mr-2 text-primary/80" />
                      <span>{person.phone}</span>
                    </a>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Contact Form Section */}
        <Card className="w-full max-w-lg mx-auto shadow-xl">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold tracking-tight">Send Us a Message</CardTitle>
            <CardDescription>
              Fill out the form and we&apos;ll get back to you as soon as possible.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isSuccess ? (
              <Alert variant="default" className="border-green-500 bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700">
                <CheckCircle className="h-4 w-4 !text-green-700 dark:!text-green-400" />
                <AlertTitle>Message Sent Successfully!</AlertTitle>
                <AlertDescription className="!text-green-700 dark:!text-green-400">
                  Thank you for reaching out. We will get back to you as soon as possible.
                </AlertDescription>
              </Alert>
            ) : (
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div>
                  <Label htmlFor="fullName">Full Name</Label>
                  <Input
                    id="fullName"
                    placeholder="John Doe"
                    {...form.register("fullName")}
                    disabled={isLoading}
                  />
                  {form.formState.errors.fullName && (
                    <p className="text-sm text-destructive mt-1">{form.formState.errors.fullName.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    {...form.register("email")}
                    disabled={isLoading}
                  />
                  {form.formState.errors.email && (
                    <p className="text-sm text-destructive mt-1">{form.formState.errors.email.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="subject">Subject (Optional)</Label>
                  <Input
                    id="subject"
                    placeholder="Inquiry about..."
                    {...form.register("subject")}
                    disabled={isLoading}
                  />
                </div>

                <div>
                  <Label htmlFor="message">Message</Label>
                  <Textarea
                    id="message"
                    placeholder="Your message here..."
                    rows={5}
                    {...form.register("message")}
                    disabled={isLoading}
                  />
                  {form.formState.errors.message && (
                    <p className="text-sm text-destructive mt-1">{form.formState.errors.message.message}</p>
                  )}
                </div>

                <Button type="submit" className="w-full" disabled={isLoading}>
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
