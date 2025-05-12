
"use client";

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
import { BookOpenText, LayoutDashboard, LogOut, UserCircle, UploadCloud, Shield, Sparkles, Menu, FileText, Users, DollarSign, MessageSquare } from 'lucide-react'; // Added Sparkles for AI Pre-Check
import { useRouter } from 'next/navigation';
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

  const commonNavLinks = (
    <>
      <NavLink href="/" onClick={() => setIsMobileMenuOpen(false)} className="text-foreground">Home</NavLink>
      {user && <NavLink href="/dashboard" onClick={() => setIsMobileMenuOpen(false)} className="text-foreground">Dashboard</NavLink>}
       <Button variant="ghost" onClick={handleSubmitPaperClick} className="w-full justify-start hover:text-primary text-foreground">
        Submit Paper
      </Button>
      {user && (
         <NavLink href="/ai-pre-check" onClick={() => setIsMobileMenuOpen(false)} className="text-foreground">
           AI Pre-Check
          </NavLink>
      )}
      <NavLink href="/registration" onClick={() => setIsMobileMenuOpen(false)} className="text-foreground">Registration & Pricing</NavLink>
      <NavLink href="/key-committee" onClick={() => setIsMobileMenuOpen(false)} className="text-foreground">Key Committee</NavLink>
      <NavLink href="/sample-templates" onClick={() => setIsMobileMenuOpen(false)} className="text-foreground">Sample Templates</NavLink>
      <NavLink href="/contact-us" onClick={() => setIsMobileMenuOpen(false)} className="text-foreground">Contact Us</NavLink>
      {user && isAdmin && (
        <NavLink href="/admin/dashboard" onClick={() => setIsMobileMenuOpen(false)} className="text-primary font-semibold">Admin Panel</NavLink>
      )}
    </>
  );


  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container px-4 sm:px-6 flex h-16 items-center">
        <Link href="/" className="mr-6 flex items-center gap-2" onClick={() => setIsMobileMenuOpen(false)}>
          <BookOpenText className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold">ResearchSphere</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center space-x-1 text-sm font-medium">
          <Link href="/" className="px-3 py-2 transition-colors hover:text-primary text-foreground">Home</Link>
          {user && <Link href="/dashboard" className="px-3 py-2 transition-colors hover:text-primary text-foreground">Dashboard</Link>}
          <Button 
            variant="ghost" 
            onClick={handleSubmitPaperClick} 
            className="px-3 py-2 transition-colors hover:text-primary hover:bg-transparent text-foreground text-sm font-medium"
          >
            Submit Paper
          </Button>
           {user && (
            <Link href="/ai-pre-check" className="px-3 py-2 transition-colors hover:text-primary text-foreground flex items-center">
              <Sparkles className="mr-1 h-4 w-4" /> AI Pre-Check
            </Link>
          )}
          <Link href="/registration" className="px-3 py-2 transition-colors hover:text-primary text-foreground">Registration</Link>
          <Link href="/key-committee" className="px-3 py-2 transition-colors hover:text-primary text-foreground">Committee</Link>
          <Link href="/sample-templates" className="px-3 py-2 transition-colors hover:text-primary text-foreground">Templates</Link>
          <Link href="/contact-us" className="px-3 py-2 transition-colors hover:text-primary text-foreground">Contact</Link>
           {user && isAdmin && (
            <Link href="/admin/dashboard" className="px-3 py-2 transition-colors hover:text-primary text-primary font-semibold">Admin</Link>
          )}
        </nav>

        {/* Auth buttons / User Menu for Desktop */}
        <div className="ml-auto hidden md:flex items-center space-x-2">
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
                <DropdownMenuItem onClick={handleSubmitPaperClick}>
                  <UploadCloud className="mr-2 h-4 w-4" />
                  <span>Submit Paper</span>
                </DropdownMenuItem>
                 <DropdownMenuItem onClick={() => router.push('/ai-pre-check')}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  <span>AI Pre-Check</span>
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
        <div className="ml-auto flex items-center md:hidden">
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
                {commonNavLinks}
                <DropdownMenuSeparator className="my-2"/>
                {user ? (
                  <>
                    <div className="px-3 py-2">
                      <p className="text-sm font-medium leading-none">{user.displayName || 'User'}</p>
                      <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                    </div>
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
