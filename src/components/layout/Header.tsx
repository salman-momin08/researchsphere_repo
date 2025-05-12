
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
import { useAuth } from '@/hooks/use-auth';
import { BookOpenText, LayoutDashboard, LogOut, UserCircle, UploadCloud, Shield, DollarSign, Users, MessageSquare, FileText } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function Header() {
  const { user, logout, setShowLoginModal, isAdmin } = useAuth();
  const router = useRouter();

  const handleLoginClick = () => {
    router.push('/login');
  };
  
  const handleSignupClick = () => {
    router.push('/signup');
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center">
        <Link href="/" className="mr-auto flex items-center gap-2">
          <BookOpenText className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold">ResearchSphere</span>
        </Link>
        <nav className="hidden md:flex items-center space-x-6 text-sm font-medium">
          <Link href="/" className="transition-colors hover:text-primary">
            Home
          </Link>
          {user && (
            <Link href="/dashboard" className="transition-colors hover:text-primary">
              Dashboard
            </Link>
          )}
          <Link href="/submit" className="transition-colors hover:text-primary">
            Submit Paper
          </Link>
          <Link href="/registration" className="transition-colors hover:text-primary">
            Registration & Pricing
          </Link>
          <Link href="/key-committee" className="transition-colors hover:text-primary">
            Key Committee
          </Link>
          <Link href="/sample-templates" className="transition-colors hover:text-primary">
            Sample Templates
          </Link>
          <Link href="/contact-us" className="transition-colors hover:text-primary">
            Contact Us
          </Link>
           {user && isAdmin && (
            <Link href="/admin/dashboard" className="transition-colors hover:text-primary">
              Admin Panel
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center space-x-4">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                  <Avatar className="h-8 w-8">
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
                <DropdownMenuItem onClick={() => router.push('/submit')}>
                  <UploadCloud className="mr-2 h-4 w-4" />
                  <span>Submit Paper</span>
                </DropdownMenuItem>
                 <DropdownMenuItem onClick={() => router.push('/registration')}>
                  <DollarSign className="mr-2 h-4 w-4" />
                  <span>Pricing</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push('/key-committee')}>
                  <Users className="mr-2 h-4 w-4" />
                  <span>Key Committee</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push('/sample-templates')}>
                  <FileText className="mr-2 h-4 w-4" />
                  <span>Sample Templates</span>
                </DropdownMenuItem>
                 <DropdownMenuItem onClick={() => router.push('/contact-us')}>
                  <MessageSquare className="mr-2 h-4 w-4" />
                  <span>Contact Us</span>
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem onClick={() => router.push('/admin/dashboard')}>
                    <Shield className="mr-2 h-4 w-4" />
                    <span>Admin Panel</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button variant="ghost" onClick={handleLoginClick}>
                Log In
              </Button>
              <Button onClick={handleSignupClick}>Sign Up</Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
