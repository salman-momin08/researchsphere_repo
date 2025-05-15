
"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { Shield, Users, LayoutDashboard, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button'; // Import Button for consistent styling

interface AdminLayoutProps {
  children: React.ReactNode;
}

const adminNavLinks = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="mr-2 h-5 w-5" /> },
  { href: '/admin/users', label: 'User Management', icon: <Users className="mr-2 h-5 w-5" /> },
  // Add more admin modules here as they are built
  // { href: '/admin/papers', label: 'Paper Management', icon: <FileText className="mr-2 h-5 w-5" /> },
];

export default function AdminLayout({ children }: AdminLayoutProps) {
  const pathname = usePathname();

  return (
    <ProtectedRoute adminOnly={true}>
      <div className="flex min-h-screen bg-secondary/30">
        <aside className="w-64 bg-background border-r p-4 space-y-4 shadow-md fixed top-0 left-0 h-full pt-20"> {/* pt-20 to offset header */}
          <div className="flex items-center gap-2 mb-6 px-2">
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
        <main className="flex-1 p-6 md:p-8 ml-64 mt-16"> {/* ml-64 for sidebar width, mt-16 for header height */}
          {children}
        </main>
      </div>
    </ProtectedRoute>
  );
}
