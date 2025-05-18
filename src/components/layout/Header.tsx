
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

interface NavLinkItemProps {
  href?: string;
  children: React.ReactNode;
  onClick?: () => void;
  isActive?: boolean;
  isAction?: boolean;
  icon?: React.ReactNode;
  isAdminContext?: boolean;
}

const NavLinkItem: React.FC<NavLinkItemProps> = ({ href, children, onClick, isActive, isAction, icon, isAdminContext }) => {
  const baseClasses = "w-full justify-start flex items-center px-3 py-2 text-base font-medium rounded-md";
  let activeStyleClasses = "";
  let hoverStyleClasses = "";

  if (isAdminContext) {
    activeStyleClasses = isActive ? "bg-primary text-primary-foreground" : "text-foreground";
    hoverStyleClasses = isActive ? "hover:bg-primary/90" : "hover:bg-accent hover:text-accent-foreground";
  } else {
    activeStyleClasses = isActive ? "bg-secondary text-primary font-semibold" : "text-foreground"; // Emphasize active user links
    hoverStyleClasses = isActive ? "hover:bg-secondary/80" : (isAction ? "hover:bg-primary/10" : "hover:bg-secondary hover:text-primary");
  }

  const combinedClasses = cn(baseClasses, activeStyleClasses, hoverStyleClasses, "[&_svg]:mr-2 [&_svg]:h-4 [&_svg]:w-4");

  if (href) {
    return (
      <Link href={href} passHref legacyBehavior>
        <Button
          variant="ghost"
          onClick={onClick} // onClick for closing sheet
          className={combinedClasses}
        >
          {icon}{children}
        </Button>
      </Link>
    );
  }
  // For actions without a direct href, like submit paper via modal
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
  return null;
};


export default function Header() {
  const { user, logout, isAdminUser, setShowLoginModal } = useAuth();
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
    if (user && !isAdminUser) {
      router.push('/author/submit');
    } else if (!user) {
      if (typeof window !== 'undefined') localStorage.setItem('redirectAfterLogin', '/author/submit');
      setShowLoginModal(true);
    }
  };
  
  const handleAiPreCheckClick = () => {
    setIsMobileMenuOpen(false);
    if (user) {
      router.push('/author/ai-pre-check');
    } else {
      if (typeof window !== 'undefined') localStorage.setItem('redirectAfterLogin', '/author/ai-pre-check');
      setShowLoginModal(true);
    }
  };

  const isViewingAdminSection = pathname.startsWith('/admin');

  const baseNavLinks = [
    { href: "/", label: "Home", icon: null },
    { href: "/registration", label: "Registration", icon: <FileTextIconLucide /> },
    { href: "/key-committee", label: "Committee", icon: <UsersIconLucide /> },
    { href: "/sample-templates", label: "Templates", icon: <FileTextIconLucide /> },
    { href: "/search-papers", label: "Search", icon: <SearchIcon /> },
    { href: "/contact-us", label: "Contact", icon: <Phone /> },
  ];

  // Links for authenticated non-admin users (Authors/Reviewers)
  const userNavLinks = [
    { href: "/", label: "Home", icon: null },
    // Dashboard link will be determined by role
    { label: "Submit Paper", action: handleSubmitPaperClick, icon: <UploadCloud />, href: "/author/submit" }, // href for active state check
    { label: "AI Pre-Check", action: handleAiPreCheckClick, icon: <Sparkles />, href: "/author/ai-pre-check" }, // href for active state check
    { href: "/key-committee", label: "Committee", icon: <UsersIconLucide /> },
    { href: "/sample-templates", label: "Templates", icon: <FileTextIconLucide /> },
    { href: "/search-papers", label: "Search", icon: <SearchIcon /> },
    { href: "/contact-us", label: "Contact", icon: <Phone /> },
  ];
  
  const adminNavLinks = [
    { href: "/admin/dashboard", label: "Admin Panel", icon: <Shield /> },
    { href: "/search-papers", label: "Search Papers", icon: <SearchIcon /> },
    { href: "/key-committee", label: "Committee", icon: <UsersIconLucide /> },
  ];
  
  const adminSidebarLinks = [ // For mobile sheet when admin is logged in
      { href: "/admin/dashboard", label: "Dashboard Overview", icon: <LayoutDashboard /> },
      { href: "/admin/users", label: "User Management", icon: <UsersIconLucide /> },
      { href: "/admin/registered-admins", label: "Registered Admins", icon: <UserCheck /> },
      { href: "/admin/reviewers", label: "Reviewer Management", icon: <Eye /> },
  ];

  let currentNavLinks: Array<{ href?: string; label: string; icon: React.ReactNode | null; action?: () => void; }> = [];
  if (isClient) {
    if (user && isAdminUser) {
      currentNavLinks = adminNavLinks;
    } else if (user) { // Authenticated non-admin
      currentNavLinks = [...userNavLinks];
      // Add role-specific dashboard link
      const dashboardLink = user.role === "Reviewer" 
        ? { href: "/reviewer/dashboard", label: "Reviewer Dashboard", icon: <Eye /> }
        : { href: "/author/dashboard", label: "Author Dashboard", icon: <LayoutDashboard /> };
      currentNavLinks.splice(1, 0, dashboardLink); // Insert dashboard link after "Home"
    } else { // Guest
      currentNavLinks = baseNavLinks;
    }
  }


  return (
    <header className={cn(
      "sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60",
      isViewingAdminSection && "md:pl-64" // Adjust main header padding if admin sidebar is present
    )}>
      <div className={cn(
          "container px-4 sm:px-6 lg:px-8 flex h-16 items-center justify-between",
          // isViewingAdminSection && "md:ml-64" // This was removed to allow full width header with offset content
          )}>
        <Link href="/" className="mr-auto md:mr-6 flex items-center gap-2" onClick={() => setIsMobileMenuOpen(false)}>
          <BookOpenText className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold">ResearchSphere</span>
        </Link>

        <nav className="hidden md:flex items-center justify-center flex-grow space-x-1 text-sm font-medium">
          {isClient && currentNavLinks.map(link => {
            // Determine active state
            let isActive = false;
            if (link.href) {
                if (link.href === "/" && pathname === "/") isActive = true;
                else if (link.href !== "/" && pathname.startsWith(link.href)) isActive = true;
                // Specific check for admin dashboard when in any admin/* route
                if (link.href === "/admin/dashboard" && isViewingAdminSection) isActive = true;
            }
            
            let buttonClasses = "";
            if (user && isAdminUser) { // Styling for admin users
              buttonClasses = cn(
                "px-3 py-2 text-sm font-medium flex items-center [&_svg]:mr-2 [&_svg]:h-4 [&_svg]:w-4",
                isActive
                  ? "bg-primary text-primary-foreground hover:bg-primary/90" // Admin active style
                  : "text-foreground hover:bg-accent hover:text-accent-foreground" // Admin inactive hover
              );
            } else { // Styling for guest or regular users
              buttonClasses = cn(
                "px-3 py-2 text-sm font-medium flex items-center [&_svg]:mr-2 [&_svg]:h-4 [&_svg]:w-4",
                isActive
                  ? "text-primary font-semibold bg-secondary" // User active style
                  : "text-foreground hover:text-primary hover:bg-secondary" // User inactive hover
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
                {isAdminUser ? (
                  <DropdownMenuItem onClick={() => router.push('/admin/dashboard')}>
                    <Shield className="mr-2 h-4 w-4" />
                    <span>Admin Panel</span>
                  </DropdownMenuItem>
                ) : user.role === "Reviewer" ? (
                   <DropdownMenuItem onClick={() => router.push('/reviewer/dashboard')}>
                    <Eye className="mr-2 h-4 w-4" />
                    <span>Reviewer Dashboard</span>
                  </DropdownMenuItem>
                ) : ( // Author or user completing profile
                  <DropdownMenuItem onClick={() => router.push('/author/dashboard')}>
                    <LayoutDashboard className="mr-2 h-4 w-4" />
                    <span>Author Dashboard</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => router.push('/author/profile/settings')}>
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Profile Settings</span>
                </DropdownMenuItem>
                {!isAdminUser && user.role !== "Reviewer" && ( 
                  <DropdownMenuItem onClick={handleSubmitPaperClick}>
                    <UploadCloud className="mr-2 h-4 w-4" />
                    <span>Submit Paper</span>
                  </DropdownMenuItem>
                )}
                {!isAdminUser && ( 
                  <DropdownMenuItem onClick={handleAiPreCheckClick}>
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

        {/* Mobile Menu */}
        <div className="flex items-center md:hidden">
          <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu className="h-6 w-6" />
                <span className="sr-only">Toggle Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[280px] sm:w-[320px] p-0">
              <SheetHeader className="p-4 border-b">
                <SheetTitle className="text-left flex items-center gap-2">
                  <BookOpenText className="h-6 w-6 text-primary" /> ResearchSphere
                </SheetTitle>
              </SheetHeader>
              <div className="flex flex-col space-y-1 p-2">
                {isClient && currentNavLinks.map(link => {
                    let isActive = false;
                    if (link.href) {
                        if (link.href === "/" && pathname === "/") isActive = true;
                        else if (link.href !== "/" && pathname.startsWith(link.href)) isActive = true;
                        if (link.href === "/admin/dashboard" && isViewingAdminSection) isActive = true;
                    }
                  return (
                    <NavLinkItem
                      key={link.href || link.label}
                      href={link.href}
                      onClick={() => {
                        if (link.action) link.action();
                        else if (link.href) router.push(link.href);
                        setIsMobileMenuOpen(false);
                      }}
                      isActive={isActive}
                      isAction={!!link.action}
                      icon={link.icon}
                      isAdminContext={!!(user && isAdminUser)}
                    >
                      {link.label}
                    </NavLinkItem>
                  );
                })}

                {/* Admin Sidebar Links in Mobile Menu */}
                {isClient && user && isAdminUser && (
                  <>
                     <DropdownMenuSeparator className="my-2" />
                     <div className="px-3 py-1 text-sm font-semibold text-muted-foreground">Admin Tools</div>
                     {adminSidebarLinks.map(link => {
                         const isActive = pathname === link.href || (link.href !== '/admin/dashboard' && pathname.startsWith(link.href));
                         return (
                             <NavLinkItem
                                key={link.href}
                                href={link.href}
                                onClick={() => {router.push(link.href); setIsMobileMenuOpen(false);}}
                                isActive={isActive}
                                icon={link.icon}
                                isAdminContext={true}
                            >
                               {link.label}
                             </NavLinkItem>
                         );
                     })}
                  </>
                )}

                <DropdownMenuSeparator className="my-2" />
                {isClient && user ? (
                  <>
                    <div className="px-3 py-2">
                      <p className="text-sm font-medium leading-none">{user.displayName || 'User'}</p>
                      <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                    </div>
                    <NavLinkItem href="/author/profile/settings" onClick={() => setIsMobileMenuOpen(false)} isActive={pathname === "/author/profile/settings"} icon={<Settings />} isAdminContext={!!(user && isAdminUser)}>
                      Profile Settings
                    </NavLinkItem>
                    {!isAdminUser && user.role !== "Reviewer" && (
                      <NavLinkItem onClick={handleSubmitPaperClick} isActive={pathname === "/author/submit"} isAction icon={<UploadCloud />} >
                        Submit Paper
                      </NavLinkItem>
                    )}
                     {!isAdminUser && (
                      <NavLinkItem onClick={handleAiPreCheckClick} isActive={pathname === "/author/ai-pre-check"} isAction icon={<Sparkles />} >
                        AI Pre-Check
                      </NavLinkItem>
                    )}
                    <Button variant="ghost" onClick={handleLogout} className="w-full justify-start text-destructive hover:text-destructive flex items-center px-3 py-2 text-base font-medium [&_svg]:mr-2 [&_svg]:h-4 [&_svg]:w-4">
                      <LogOut /> Log Out
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
