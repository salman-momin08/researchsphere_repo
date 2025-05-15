
"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { Shield, Users, LayoutDashboard, FileText as FileTextIcon, UserCheck, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface AdminLayoutProps {
  children: React.ReactNode;
}

const adminNavLinks = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="mr-2 h-5 w-5" /> },
  { href: '/admin/users', label: 'User Management', icon: <Users className="mr-2 h-5 w-5" /> },
  { href: '/admin/registered-admins', label: 'Registered Admins', icon: <UserCheck className="mr-2 h-5 w-5" /> },
  { href: '/admin/reviewers', label: 'Reviewer Management', icon: <Eye className="mr-2 h-5 w-5" /> },
];

export default function AdminLayout({ children }: AdminLayoutProps) {
  const pathname = usePathname();

  return (
    <ProtectedRoute adminOnly={true}>
      {/* Changed min-h-screen to flex-1 to allow it to grow within RootLayout's main.flex-grow */}
      <div className="flex flex-1 bg-secondary/30"> 
        <aside className="w-64 bg-background border-r p-4 space-y-4 shadow-md fixed top-0 left-0 h-full pt-16"> {/* Sidebar, fixed, pt-16 to be below header */}
          <div className="flex items-center gap-2 mb-6 px-2 mt-4"> {/* Added mt-4 to push content below header area within sidebar */}
            <Shield className="h-7 w-7 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight">Admin Panel</h2>
          </div>
          <nav className="flex flex-col space-y-1">
            {adminNavLinks.map((link) => (
              <Link key={link.href} href={link.href} passHref>
                <Button
                  variant={pathname === link.href || (link.href !== '/admin/dashboard' && pathname.startsWith(link.href)) ? 'default' : 'ghost'}
                  className={cn(
                    'w-full justify-start text-base py-3 px-3',
                    (pathname === link.href || (link.href !== '/admin/dashboard' && pathname.startsWith(link.href)))
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  {link.icon}
                  {link.label}
                </Button>
              </Link>
            ))}
          </nav>
        </aside>
        {/* Main content area for admin pages */}
        <main className="flex-1 flex flex-col ml-64 mt-16"> {/* ml-64 for sidebar, mt-16 for header, flex flex-col */}
          <div className="flex-grow p-6 md:p-8"> {/* Inner div that grows */}
            {children}
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
