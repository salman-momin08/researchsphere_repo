
"use client";

import { useEffect, useState } from 'react';
import { User } from '@/types';
import { getAllUsers } from '@/lib/user-service'; // We'll create this service
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Users as UsersIcon, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button'; // For future actions
import { toast } from '@/hooks/use-toast';

export default function UserManagementPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUsers = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const fetchedUsers = await getAllUsers();
        setUsers(fetchedUsers);
      } catch (err: any) {
        console.error("Error fetching users:", err);
        setError(err.message || "Failed to load users.");
        toast({ variant: "destructive", title: "Error Loading Users", description: err.message });
      } finally {
        setIsLoading(false);
      }
    };
    fetchUsers();
  }, []);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-10">
        <LoadingSpinner size={32} /> <p className="ml-2">Loading users...</p>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-lg">
        <CardHeader>
          <div className="flex items-center gap-2">
            <UsersIcon className="h-6 w-6 text-primary" />
            <CardTitle className="text-2xl">User Management</CardTitle>
          </div>
          <CardDescription>View and manage all registered users on the platform.</CardDescription>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No users found.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Display Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Admin</TableHead>
                    <TableHead>Joined</TableHead>
                    {/* <TableHead className="text-right">Actions</TableHead> */}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.displayName || 'N/A'}</TableCell>
                      <TableCell>{user.email || 'N/A'}</TableCell>
                      <TableCell>{user.username || 'N/A'}</TableCell>
                      <TableCell>
                        <Badge variant={user.role === "Admin" ? "default" : "secondary"}>
                          {user.role || 'N/A'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {user.isAdmin ? (
                          <Badge variant="default">Yes</Badge>
                        ) : (
                          <Badge variant="outline">No</Badge>
                        )}
                      </TableCell>
                      <TableCell>{user.createdAt ? new Date(user.createdAt as string).toLocaleDateString() : 'N/A'}</TableCell>
                      {/* <TableCell className="text-right">
                        <Button variant="outline" size="sm">Edit</Button>
                      </TableCell> */}
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
