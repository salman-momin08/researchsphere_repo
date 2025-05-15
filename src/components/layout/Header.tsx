
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
import { BookOpenText, LayoutDashboard, LogOut, UserCircle, UploadCloud, Sparkles, Menu, Settings, Search as SearchIcon, Users as UsersIconLucide, FileText as FileTextIconLucide, Phone, Shield, UserCheck, Eye } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

// Adjusted NavLinkItem for better style handling, especially for mobile sheet
const NavLinkItem = ({ href, children, onClick, isActive, isAction, icon, isAdminContext }: {
  href?: string,
  children: React.ReactNode,
  onClick?: () => void,
  isActive?: boolean,
  isAction?: boolean,
  icon?: React.ReactNode,
  isAdminContext?: boolean
}) => {
  const baseClasses = "w-full justify-start flex items-center px-3 py-2 text-base font-medium";
  let activeStyleClasses = "";
  let hoverStyleClasses = "";

  if (isAdminContext) {
    activeStyleClasses = isActive ? "bg-primary text-primary-foreground" : "text-foreground";
    hoverStyleClasses = isActive ? "hover:bg-primary/90" : "hover:bg-accent hover:text-accent-foreground";
  } else { // Non-admin users or general links
    activeStyleClasses = isActive ? "bg-secondary text-primary" : "text-foreground";
    hoverStyleClasses = isActive ? "hover:bg-secondary/80" : "hover:bg-secondary hover:text-primary";
  }

  const combinedClasses = cn(baseClasses, activeStyleClasses, hoverStyleClasses);

  if (isAction && onClick) {
    return (
      <Button
        variant="ghost"
        onClick={onClick}
        className={combinedClasses}
      >
        {icon}{children}
      </Button>
    );
  }

  if (href) {
    return (
      <Link href={href} passHref legacyBehavior>
        <Button
          variant="ghost"
          onClick={onClick}
          className={combinedClasses}
        >
          {icon}{children}
        </Button>
      </Link>
    );
  }
  return null;
};


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
  };

  const handleSubmitPaperClick = () => {
    setIsMobileMenuOpen(false);
    if (user && !isAdmin) {
      router.push('/submit');
    } else if (!user) {
      localStorage.setItem('redirectAfterLogin', '/submit');
      setShowLoginModal(true);
    }
  };

  const isViewingAdminSection = pathname.startsWith('/admin');

  const baseNavLinks = [
    { href: "/", label: "Home", icon: null },
    { href: "/registration", label: "Registration", icon: <FileTextIconLucide className="mr-2 h-4 w-4" /> },
    { href: "/key-committee", label: "Committee", icon: <UsersIconLucide className="mr-2 h-4 w-4" /> },
    { href: "/sample-templates", label: "Templates", icon: <FileTextIconLucide className="mr-2 h-4 w-4" /> },
    { href: "/contact-us", label: "Contact", icon: <Phone className="mr-2 h-4 w-4" /> },
    { href: "/search-papers", label: "Search", icon: <SearchIcon className="mr-2 h-4 w-4" /> },
  ];

  const userNavLinks = [
    { href: "/", label: "Home", icon: null },
    { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard className="mr-2 h-4 w-4" /> },
    { label: "Submit Paper", action: handleSubmitPaperClick, icon: <UploadCloud className="mr-2 h-4 w-4" />, href: "/submit" },
    { href: "/ai-pre-check", label: "AI Pre-Check", icon: <Sparkles className="mr-2 h-4 w-4" /> },
    { href: "/search-papers", label: "Search", icon: <SearchIcon className="mr-2 h-4 w-4" /> },
    { href: "/key-committee", label: "Committee", icon: <UsersIconLucide className="mr-2 h-4 w-4" /> },
    { href: "/sample-templates", label: "Templates", icon: <FileTextIconLucide className="mr-2 h-4 w-4" /> },
    { href: "/contact-us", label: "Contact", icon: <Phone className="mr-2 h-4 w-4" /> },
  ];
  
  const adminNavLinks = [
    { href: "/admin/dashboard", label: "Admin Panel", icon: <Shield className="mr-2 h-4 w-4" /> },
    { href: "/search-papers", label: "Search Papers", icon: <SearchIcon className="mr-2 h-4 w-4" /> },
    { href: "/key-committee", label: "Committee", icon: <UsersIconLucide className="mr-2 h-4 w-4" /> },
  ];

  const adminSidebarLinks = [ // For mobile menu when admin is logged in
      { href: "/admin/dashboard", label: "Dashboard Overview", icon: <LayoutDashboard className="mr-2 h-4 w-4" /> },
      { href: "/admin/users", label: "User Management", icon: <UsersIconLucide className="mr-2 h-4 w-4" /> },
      { href: "/admin/registered-admins", label: "Registered Admins", icon: <UserCheck className="mr-2 h-4 w-4" /> },
      { href: "/admin/reviewers", label: "Reviewer Management", icon: <Eye className="mr-2 h-4 w-4" /> }, // New reviewer link
  ];


  let currentNavLinks: Array<{ href?: string; label: string; icon: React.ReactNode | null; action?: () => void; }> = [];
  if (isClient) {
    if (user && isAdmin) {
      currentNavLinks = adminNavLinks;
    } else if (user && !isAdmin) {
      currentNavLinks = userNavLinks;
    } else {
      currentNavLinks = baseNavLinks;
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
          {isClient && currentNavLinks.map(link => {
            const isActive = pathname === link.href || (link.href && link.href !== '/' && pathname.startsWith(link.href) && link.href !== '/admin/dashboard' && !pathname.startsWith('/admin/users') && !pathname.startsWith('/admin/registered-admins') && !pathname.startsWith('/admin/reviewers') ) || (link.href === '/admin/dashboard' && pathname.startsWith('/admin'));
            
            let buttonClasses = "";

            if (user && isAdmin) {
              buttonClasses = cn(
                "px-3 py-2 text-sm font-medium flex items-center",
                isActive
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "text-foreground hover:bg-accent hover:text-accent-foreground"
              );
            } else { 
              buttonClasses = cn(
                "px-3 py-2 text-sm font-medium flex items-center",
                isActive
                  ? "text-primary font-semibold bg-secondary"
                  : "text-foreground hover:text-primary hover:bg-secondary"
              );
            }

            return (
              <Button
                key={link.href || link.label}
                variant="ghost"
                onClick={() => {
                  if (link.action) link.action();
                  else if (link.href) router.push(link.href);
                  setIsMobileMenuOpen(false);
                }}
                className={buttonClasses}
              >
                {link.icon}{link.label}
              </Button>
            );
          })}
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
          ) : null}
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
                {isClient && currentNavLinks.map(link => (
                  <NavLinkItem
                    key={link.href || link.label}
                    href={link.href}
                    onClick={() => {
                      if (link.action) link.action();
                      else if (link.href) router.push(link.href);
                      setIsMobileMenuOpen(false);
                    }}
                    isActive={pathname === link.href || (link.href && link.href !== '/' && pathname.startsWith(link.href) && link.href !== '/admin/dashboard' && !pathname.startsWith('/admin/users') && !pathname.startsWith('/admin/registered-admins') && !pathname.startsWith('/admin/reviewers')) || (link.href === '/admin/dashboard' && pathname.startsWith('/admin'))}
                    isAction={!!link.action}
                    icon={link.icon}
                    isAdminContext={!!(user && isAdmin)}
                  >
                    {link.label}
                  </NavLinkItem>
                ))}
                
                {isClient && user && isAdmin && (
                  <>
                     <DropdownMenuSeparator className="my-2" />
                     {adminSidebarLinks.map(link => (
                         <NavLinkItem 
                            key={link.href} 
                            href={link.href} 
                            onClick={() => {router.push(link.href); setIsMobileMenuOpen(false);}} 
                            isActive={pathname.startsWith(link.href)} 
                            icon={link.icon} 
                            isAdminContext={true}
                        >
                           {link.label}
                         </NavLinkItem>
                     ))}
                  </>
                )}
                
                <DropdownMenuSeparator className="my-2" />
                {isClient && user ? (
                  <>
                    <div className="px-3 py-2">
                      <p className="text-sm font-medium leading-none">{user.displayName || 'User'}</p>
                      <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                    </div>
                    <NavLinkItem href="/profile/settings" onClick={() => setIsMobileMenuOpen(false)} isActive={pathname === "/profile/settings"} icon={<Settings className="mr-2 h-4 w-4" />} isAdminContext={!!(user && isAdmin)}>
                      Profile Settings
                    </NavLinkItem>
                    {!isAdmin && (
                      <NavLinkItem onClick={() => { handleSubmitPaperClick(); setIsMobileMenuOpen(false); }} isActive={pathname === "/submit"} isAction={true} icon={<UploadCloud className="mr-2 h-4 w-4" />} >
                        Submit Paper
                      </NavLinkItem>
                    )}
                    {!isAdmin && (
                      <NavLinkItem href="/ai-pre-check" onClick={() => setIsMobileMenuOpen(false)} isActive={pathname === "/ai-pre-check"} icon={<Sparkles className="mr-2 h-4 w-4" />} >
                        AI Pre-Check
                      </NavLinkItem>
                    )}
                    <Button variant="ghost" onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }} className="w-full justify-start text-destructive hover:text-destructive flex items-center px-3 py-2 text-base font-medium">
                      <LogOut className="mr-2 h-4 w-4" /> Log Out
                    </Button>
                  </>
                ) : isClient ? (
                  <>
                    <Button variant="default" onClick={() => { handleLoginClick(); setIsMobileMenuOpen(false); }} className="w-full justify-start">Log In</Button>
                    <Button variant="outline" onClick={() => { handleSignupClick(); setIsMobileMenuOpen(false); }} className="w-full justify-start">Sign Up</Button>
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
