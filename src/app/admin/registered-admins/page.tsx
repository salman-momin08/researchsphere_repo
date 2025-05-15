
"use client";

import { useEffect, useState } from 'react';
import type { User } from '@/types';
import { getAllUsers } from '@/lib/user-service'; 
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ShieldCheck, UserCheck, AlertTriangle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

export default function RegisteredAdminsPage() {
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAdminUsers = async () => {
      setIsLoading(true);
      setError(null);
      // console.log("RegisteredAdminsPage: Fetching all users to filter for admins...");
      try {
        const allUsers = await getAllUsers();
        const filteredAdmins = allUsers.filter(user => user.isAdmin === true);
        // console.log(`RegisteredAdminsPage: Found ${filteredAdmins.length} admin users.`);
        setAdminUsers(filteredAdmins);
      } catch (err: any) {
        console.error("RegisteredAdminsPage: Error fetching users:", err);
        setError(err.message || "Failed to load admin users.");
        toast({ variant: "destructive", title: "Error Loading Admins", description: err.message });
      } finally {
        setIsLoading(false);
      }
    };

    fetchAdminUsers();
  }, []);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-10">
        <LoadingSpinner size={32} /> <p className="ml-2">Loading registered admins...</p>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className="w-full max-w-2xl mx-auto">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-lg w-full"> 
        <CardHeader>
          <div className="flex items-center gap-2">
            <UserCheck className="h-6 w-6 text-primary" />
            <CardTitle className="text-2xl">Registered Administrators</CardTitle>
          </div>
          <CardDescription>View all users with administrative privileges on the platform. ({adminUsers.length} admins found)</CardDescription>
        </CardHeader>
        <CardContent>
          {adminUsers.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No administrators found.</p>
          ) : (
            <div className="overflow-x-auto"> 
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Display Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adminUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.displayName || 'N/A'}</TableCell>
                      <TableCell>{user.email || 'N/A'}</TableCell>
                      <TableCell>{user.username || 'N/A'}</TableCell>
                      <TableCell>
                        <Badge variant={"default"} className="bg-green-600 hover:bg-green-700">
                           <ShieldCheck className="mr-1 h-3.5 w-3.5" /> {user.role || 'Admin'}
                        </Badge>
                      </TableCell>
                      <TableCell>{user.createdAt ? new Date(user.createdAt as string).toLocaleDateString() : 'N/A'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
