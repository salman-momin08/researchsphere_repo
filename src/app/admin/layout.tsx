
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
  { href: '/admin/dashboard', label: 'Dashboard Overview', icon: <LayoutDashboard /> }, // Changed label
  { href: '/admin/users', label: 'User Management', icon: <Users /> },
  { href: '/admin/registered-admins', label: 'Registered Admins', icon: <UserCheck /> },
  { href: '/admin/reviewers', label: 'Reviewer Management', icon: <Eye /> },
];

export default function AdminLayout({ children }: AdminLayoutProps) {
  const pathname = usePathname();

  return (
    <ProtectedRoute adminOnly={true}>
      <div className="flex flex-1 bg-secondary/30">
        <aside className="hidden md:flex w-64 bg-background border-r p-4 space-y-4 shadow-md fixed top-0 left-0 h-full pt-16 flex-col">
          <div className="flex items-center gap-2 mb-6 px-2 mt-4">
            <Shield className="h-7 w-7 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight">Admin Panel</h2>
          </div>
          <nav className="flex flex-col space-y-1">
            {adminNavLinks.map((link) => (
              <Link key={link.href} href={link.href} passHref>
                <Button
                  variant={pathname === link.href || (link.href !== '/admin/dashboard' && pathname.startsWith(link.href)) ? 'default' : 'ghost'}
                  className={cn(
                    'w-full justify-start text-base py-3 px-3 [&_svg]:mr-2 [&_svg]:h-5 [&_svg]:w-5', // Ensure icon spacing
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
        <main className="flex-1 flex flex-col md:ml-64 mt-16">
          <div className="flex-grow p-6 md:p-8">
            {children}
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
