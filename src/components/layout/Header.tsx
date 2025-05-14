
"use client";

import React from 'react';
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
import { BookOpenText, LayoutDashboard, LogOut, UserCircle, UploadCloud, Shield, Sparkles, Menu, FileText, Users, DollarSign, MessageSquare, Settings, Search as SearchIcon } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useState } from 'react';
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
    if (user) {
      router.push('/submit');
    } else {
      localStorage.setItem('redirectAfterLogin', '/submit');
      setShowLoginModal(true);
    }
  };

  const isViewingAdminSection = isAdmin && pathname.startsWith('/admin');

  const mainNavLinks = [
    { href: "/", label: "Home", icon: null, adminOnlyPage: false, hideInAdminView: false },
    { href: "/dashboard", label: "Dashboard", icon: null, requiresAuth: true, adminOnlyPage: false, hideInAdminView: false },
    { href: "/submit", label: "Submit Paper", icon: null, action: handleSubmitPaperClick, requiresAuthDynamic: true, adminOnlyPage: false, hideInAdminView: true },
    { href: "/ai-pre-check", label: "AI Pre-Check", icon: <Sparkles className="mr-1 h-4 w-4" />, requiresAuth: true, adminOnlyPage: false, hideInAdminView: false }, // AI Pre-Check is a tool, might still be useful for admins
    { href: "/search-papers", label: "Search", icon: <SearchIcon className="mr-1 h-4 w-4" />, requiresAuth: true, adminOnlyPage: false, hideInAdminView: false },
    { href: "/registration", label: "Registration", icon: null, adminOnlyPage: false, hideInAdminView: true },
    { href: "/key-committee", label: "Committee", icon: null, adminOnlyPage: false, hideInAdminView: false }, // Committee info might be relevant for admins too
    { href: "/sample-templates", label: "Templates", icon: null, adminOnlyPage: false, hideInAdminView: true },
    { href: "/contact-us", label: "Contact", icon: null, adminOnlyPage: false, hideInAdminView: true },
    { href: "/admin/dashboard", label: "Admin", icon: null, requiresAuth: true, adminOnlyPage: true, hideInAdminView: false },
  ];

  const getFilteredNavLinks = (isMobile: boolean) => {
    return mainNavLinks.filter(link => {
      if (link.adminOnlyPage && !isAdmin) return false; 
      if (isViewingAdminSection && link.hideInAdminView) return false; 
      if (link.requiresAuth && !user && !isMobile) return false; 
      return true;
    });
  };


  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container px-4 sm:px-6 lg:px-8 flex h-16 items-center justify-between">
        <Link href="/" className="mr-auto md:mr-6 flex items-center gap-2" onClick={() => setIsMobileMenuOpen(false)}>
          <BookOpenText className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold">ResearchSphere</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center justify-center flex-grow space-x-1 text-sm font-medium">
          {getFilteredNavLinks(false).map(link => (
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
                  link.adminOnlyPage && pathname === link.href && "text-primary font-bold underline" 
                )}
              >
                {link.icon}{link.label}
              </Link>
            )
          ))}
        </nav>

        {/* Auth buttons / User Menu for Desktop */}
        <div className="hidden md:flex items-center space-x-2 ml-auto">
          {user ? (
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
                <DropdownMenuItem onClick={() => router.push('/dashboard')}>
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  <span>Dashboard</span>
                </DropdownMenuItem>
                 <DropdownMenuItem onClick={() => router.push('/profile/settings')}>
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Profile Settings</span>
                </DropdownMenuItem>
                {!isViewingAdminSection && (
                    <DropdownMenuItem onClick={handleSubmitPaperClick}>
                        <UploadCloud className="mr-2 h-4 w-4" />
                        <span>Submit Paper</span>
                    </DropdownMenuItem>
                )}
                 <DropdownMenuItem onClick={() => router.push('/ai-pre-check')}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  <span>AI Pre-Check</span>
                </DropdownMenuItem>
                 <DropdownMenuItem onClick={() => router.push('/search-papers')}>
                  <SearchIcon className="mr-2 h-4 w-4" />
                  <span>Search Papers</span>
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem onClick={() => router.push('/admin/dashboard')}>
                    <Shield className="mr-2 h-4 w-4" />
                    <span>Admin Panel</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button variant="ghost" onClick={handleLoginClick} className="text-foreground">Log In</Button>
              <Button onClick={handleSignupClick}>Sign Up</Button>
            </>
          )}
        </div>

        {/* Mobile Navigation Trigger */}
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
                {getFilteredNavLinks(true).map(link => (
                   link.action ? (
                    <Button 
                      key={link.href} 
                      variant="ghost" 
                      onClick={() => { link.action!(); setIsMobileMenuOpen(false); }} 
                      className={cn("w-full justify-start hover:text-primary text-foreground", pathname === link.href && "text-primary bg-secondary")}
                    >
                      {link.icon && React.cloneElement(link.icon, {className: "mr-2 h-4 w-4"})} {link.label}
                    </Button>
                  ) : (
                    <NavLink 
                      key={link.href} 
                      href={link.href} 
                      onClick={() => setIsMobileMenuOpen(false)} 
                      className={cn("text-foreground", 
                                   pathname === link.href && "text-primary bg-secondary",
                                   link.adminOnlyPage && pathname === link.href && "font-bold"
                                  )}
                    >
                       {link.icon && React.cloneElement(link.icon, {className: "mr-2 h-4 w-4"})} {link.label}
                    </NavLink>
                  )
                ))}
                <DropdownMenuSeparator className="my-2"/>
                {user ? (
                  <>
                    <div className="px-3 py-2">
                      <p className="text-sm font-medium leading-none">{user.displayName || 'User'}</p>
                      <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                    </div>
                     <NavLink href="/profile/settings" onClick={() => setIsMobileMenuOpen(false)} className={cn("text-foreground", pathname === "/profile/settings" && "text-primary bg-secondary")}>
                        <Settings className="mr-2 h-4 w-4" /> Profile Settings
                     </NavLink>
                    <Button variant="ghost" onClick={handleLogout} className="w-full justify-start text-destructive hover:text-destructive">
                      <LogOut className="mr-2 h-4 w-4" /> Log Out
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="default" onClick={handleLoginClick} className="w-full justify-start">Log In</Button>
                    <Button variant="outline" onClick={handleSignupClick} className="w-full justify-start">Sign Up</Button>
                  </>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
