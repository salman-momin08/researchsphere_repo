
"use client";

import React, { useState, useEffect } from 'react'; 
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAuth } from '@/hooks/use-auth';
import { BookOpenText, LayoutDashboard, LogOut, UserCircle, UploadCloud, Shield, Sparkles, Menu, Settings, Search as SearchIcon, Users, FileText as FileTextIcon, Phone, Info as InfoIcon, MessageSquare } from 'lucide-react'; 
import { useRouter, usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';


const NavLink = ({ href, children, onClick, className }: { href: string, children: React.ReactNode, onClick?: () => void, className?: string }) => (
  <Link href={href} passHref>
    <Button variant="ghost" className={cn("w-full justify-start hover:text-primary", className)} onClick={onClick}>
      {children}
    </Button>
  </Link>
);

export default function Header() {
  const { user, logout, isAdmin, setShowLoginModal } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isClient, setIsClient] = useState(false); 

  useEffect(() => {
    setIsClient(true); 
  }, []);


  const handleLoginClick = () => {
    setIsMobileMenuOpen(false);
    setShowLoginModal(true);
  };
  
  const handleSignupClick = () => {
    setIsMobileMenuOpen(false);
    router.push('/signup');
  };

  const handleLogout = async () => {
    setIsMobileMenuOpen(false);
    await logout();
  }
  
  const handleSubmitPaperClick = () => {
    setIsMobileMenuOpen(false); 
    if (user && !isAdmin) { 
      router.push('/submit');
    } else if (!user) {
      localStorage.setItem('redirectAfterLogin', '/submit');
      setShowLoginModal(true);
    }
  };

  const baseNavLinks = [
    { href: "/", label: "Home", icon: null, adminOnly: false, userOnly: false },
    { href: "/registration", label: "Registration", icon: null, adminOnly: false, userOnly: false },
    { href: "/key-committee", label: "Committee", icon: <Users className="mr-1 h-4 w-4" />, adminOnly: false, userOnly: false },
    { href: "/sample-templates", label: "Templates", icon: <FileTextIcon className="mr-1 h-4 w-4" />, adminOnly: false, userOnly: false },
    { href: "/contact-us", label: "Contact", icon: <Phone className="mr-1 h-4 w-4" />, adminOnly: false, userOnly: false },
  ];

  const userSpecificNavLinks = [
    { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard className="mr-1 h-4 w-4" />, userOnly: true, adminOnly: false },
    { href: "/submit", label: "Submit Paper", action: handleSubmitPaperClick, icon: <UploadCloud className="mr-1 h-4 w-4" />, userOnly: true, adminOnly: false },
    { href: "/ai-pre-check", label: "AI Pre-Check", icon: <Sparkles className="mr-1 h-4 w-4" />, userOnly: true, adminOnly: false },
    { href: "/search-papers", label: "Search", icon: <SearchIcon className="mr-1 h-4 w-4" />, userOnly: true, adminOnly: false },
  ];

  const adminSpecificNavLinks = [
    { href: "/admin/dashboard", label: "Admin Panel", icon: <Shield className="mr-1 h-4 w-4" />, adminOnly: true, userOnly: false },
    { href: "/search-papers", label: "Search Papers", icon: <SearchIcon className="mr-1 h-4 w-4" />, adminOnly: true, userOnly: false }, // Admins can also search
  ];
  
  let currentNavLinks = [];
  if (isClient) {
    if (user && isAdmin) {
      currentNavLinks = [...baseNavLinks.filter(link => !link.userOnly), ...adminSpecificNavLinks];
      // Filter out links not relevant for admins from baseNavLinks
      currentNavLinks = currentNavLinks.filter(link => !["/registration", "/submit", "/ai-pre-check", "/sample-templates", "/contact-us"].includes(link.href));
    } else if (user && !isAdmin) {
      currentNavLinks = [...baseNavLinks.filter(link => !link.adminOnly), ...userSpecificNavLinks];
    } else {
      currentNavLinks = baseNavLinks.filter(link => !link.adminOnly && !link.userOnly);
    }
  }


  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container px-4 sm:px-6 lg:px-8 flex h-16 items-center justify-between">
        <Link href="/" className="mr-auto md:mr-6 flex items-center gap-2" onClick={() => setIsMobileMenuOpen(false)}>
          <BookOpenText className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold">ResearchSphere</span>
        </Link>

        <nav className="hidden md:flex items-center justify-center flex-grow space-x-1 text-sm font-medium">
          {currentNavLinks.map(link => (
            link.action ? (
              <Button
                key={link.href} 
                variant="ghost"
                onClick={link.action}
                className="px-3 py-2 transition-colors hover:text-primary hover:bg-transparent text-foreground text-sm font-medium"
              >
                {link.icon}{link.label}
              </Button>
            ) : (
              <Link 
                key={link.href} 
                href={link.href} 
                className={cn(
                  "px-3 py-2 transition-colors hover:text-primary text-foreground flex items-center",
                  pathname === link.href && "text-primary font-semibold",
                  (link.href === '/admin/dashboard' && pathname.startsWith('/admin')) && "text-primary font-bold underline" 
                )}
              >
                {link.icon}{link.label}
              </Link>
            )
          ))}
        </nav>

        <div className="hidden md:flex items-center space-x-2 ml-auto">
          {isClient && user ? ( 
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-9 w-9 rounded-full">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={user.photoURL || undefined} alt={user.displayName || 'User'} />
                    <AvatarFallback>{user.displayName ? user.displayName.charAt(0).toUpperCase() : <UserCircle />}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user.displayName || 'User'}</p>
                    <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {isAdmin ? (
                     <DropdownMenuItem onClick={() => router.push('/admin/dashboard')}>
                        <Shield className="mr-2 h-4 w-4" />
                        <span>Admin Panel</span>
                    </DropdownMenuItem>
                ) : (
                    <DropdownMenuItem onClick={() => router.push('/dashboard')}>
                        <LayoutDashboard className="mr-2 h-4 w-4" />
                        <span>Dashboard</span>
                    </DropdownMenuItem>
                )}
                 <DropdownMenuItem onClick={() => router.push('/profile/settings')}>
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Profile Settings</span>
                </DropdownMenuItem>
                {!isAdmin && ( 
                    <DropdownMenuItem onClick={handleSubmitPaperClick}>
                        <UploadCloud className="mr-2 h-4 w-4" />
                        <span>Submit Paper</span>
                    </DropdownMenuItem>
                )}
                {!isAdmin && (
                   <DropdownMenuItem onClick={() => router.push('/ai-pre-check')}>
                    <Sparkles className="mr-2 h-4 w-4" />
                    <span>AI Pre-Check</span>
                  </DropdownMenuItem>
                )}
                 <DropdownMenuItem onClick={() => router.push('/search-papers')}>
                  <SearchIcon className="mr-2 h-4 w-4" />
                  <span>Search Papers</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : isClient ? ( 
            <>
              <Button variant="ghost" onClick={handleLoginClick} className="text-foreground">Log In</Button>
              <Button onClick={handleSignupClick}>Sign Up</Button>
            </>
          ) : null }
        </div>

        <div className="flex items-center md:hidden"> 
          <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu className="h-6 w-6" />
                <span className="sr-only">Toggle Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[280px] sm:w-[320px]">
              <SheetHeader className="mb-4">
                <SheetTitle className="text-left flex items-center gap-2">
                  <BookOpenText className="h-6 w-6 text-primary" /> ResearchSphere
                </SheetTitle>
              </SheetHeader>
              <div className="flex flex-col space-y-1">
                {currentNavLinks.map(link => ( 
                   link.action ? (
                        <Button 
                          key={link.href} 
                          variant="ghost" 
                          onClick={() => { link.action!(); setIsMobileMenuOpen(false); }} 
                          className={cn("w-full justify-start hover:text-primary text-foreground", pathname === link.href && "text-primary bg-secondary")}
                        >
                          {link.icon}{link.label}
                        </Button>
                  ) : (
                    <NavLink 
                      key={link.href} 
                      href={link.href} 
                      onClick={() => setIsMobileMenuOpen(false)} 
                      className={cn("text-foreground", 
                                   pathname === link.href && "text-primary bg-secondary",
                                   (link.href === '/admin/dashboard' && pathname.startsWith('/admin')) && "font-bold"
                                  )}
                    >
                       {link.icon}{link.label}
                    </NavLink>
                  )
                ))}
                <DropdownMenuSeparator className="my-2"/>
                {isClient && user ? (
                  <>
                    <div className="px-3 py-2">
                      <p className="text-sm font-medium leading-none">{user.displayName || 'User'}</p>
                      <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                    </div>
                     <NavLink href="/profile/settings" onClick={() => setIsMobileMenuOpen(false)} className={cn("text-foreground", pathname === "/profile/settings" && "text-primary bg-secondary")}>
                        <Settings className="mr-2 h-4 w-4" /> Profile Settings
                     </NavLink>
                    {!isAdmin && (
                       <NavLink href="/ai-pre-check" onClick={() => { router.push('/ai-pre-check'); setIsMobileMenuOpen(false); }} className={cn("text-foreground", pathname === "/ai-pre-check" && "text-primary bg-secondary")}>
                          <Sparkles className="mr-2 h-4 w-4" /> AI Pre-Check
                       </NavLink>
                    )}
                    <Button variant="ghost" onClick={handleLogout} className="w-full justify-start text-destructive hover:text-destructive">
                      <LogOut className="mr-2 h-4 w-4" /> Log Out
                    </Button>
                  </>
                ) : isClient ? (
                  <>
                    <Button variant="default" onClick={handleLoginClick} className="w-full justify-start">Log In</Button>
                    <Button variant="outline" onClick={handleSignupClick} className="w-full justify-start">Sign Up</Button>
                  </>
                ) : null}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

