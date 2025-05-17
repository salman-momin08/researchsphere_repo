
"use client";

import { useEffect, useState } from 'react';
import type { User } from '@/types'; 
import { getAllUsers, toggleUserAdminStatus, toggleUserSuspensionStatus } from '@/lib/user-service';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Users as UsersIcon, AlertTriangle, ShieldCheck, ShieldOff, Ban, Undo } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';

export default function UserManagementPage() {
  const { user: currentAdminUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fetchedUsers = await getAllUsers();
      setUsers(fetchedUsers);
    } catch (err: any) {
      setError(err.message || "Failed to load users.");
      toast({ variant: "destructive", title: "Error Loading Users", description: err.message });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleToggleAdmin = async (targetUserId: string, currentIsAdmin: boolean | undefined) => {
    if (!currentAdminUser || currentAdminUser.id === targetUserId) {
      toast({ variant: "destructive", title: "Action Not Allowed", description: "Admins cannot change their own admin status through this interface." });
      return;
    }

    const confirmAction = confirm(`Are you sure you want to ${currentIsAdmin ? 'revoke' : 'grant'} admin privileges for this user?`);
    if (!confirmAction) return;

    try {
      await toggleUserAdminStatus(targetUserId, !!currentIsAdmin);
      toast({ title: "Success", description: `User admin status updated.` });
      fetchUsers(); // Refresh the list
    } catch (err: any) {
      toast({ variant: "destructive", title: "Update Failed", description: err.message || "Could not update admin status." });
    }
  };

  const handleToggleSuspension = async (targetUserId: string, currentIsSuspended: boolean | undefined) => {
     if (!currentAdminUser || currentAdminUser.id === targetUserId) {
      toast({ variant: "destructive", title: "Action Not Allowed", description: "Admins cannot suspend their own account through this interface." });
      return;
    }
    const confirmAction = confirm(`Are you sure you want to ${currentIsSuspended ? 'unsuspend' : 'suspend'} this user?`);
    if (!confirmAction) return;

    try {
      await toggleUserSuspensionStatus(targetUserId, !!currentIsSuspended);
      toast({ title: "Success", description: `User suspension status updated.` });
      fetchUsers(); // Refresh list
    } catch (err: any)
     {
      toast({ variant: "destructive", title: "Update Failed", description: err.message || "Could not update user suspension status." });
    }
  }


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
      <Card className="shadow-lg w-full">
        <CardHeader>
          <div className="flex items-center gap-2">
            <UsersIcon className="h-6 w-6 text-primary" />
            <CardTitle className="text-2xl">User Management</CardTitle>
          </div>
          <CardDescription>View and manage all registered users on the platform. ({users.length} users found)</CardDescription>
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
                    <TableHead>Role</TableHead>
                    <TableHead>Admin</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id} className={user.isSuspended ? "bg-destructive/10" : ""}>
                      <TableCell className="font-medium">{user.displayName || 'N/A'}</TableCell>
                      <TableCell>{user.email || 'N/A'}</TableCell>
                      <TableCell>
                        <Badge variant={user.role === "Admin" ? "default" : "secondary"}>
                          {user.role || 'N/A'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {user.isAdmin ? (
                          <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                            <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Yes
                          </Badge>
                        ) : (
                          <Badge variant="outline">
                            <ShieldOff className="mr-1 h-3.5 w-3.5" /> No
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {user.isSuspended ? (
                          <Badge variant="destructive">
                            <Ban className="mr-1 h-3.5 w-3.5" /> Suspended
                          </Badge>
                        ) : (
                          <Badge variant="default" className="bg-green-500 hover:bg-green-600">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-1 flex justify-end items-center">
                        <Button
                          variant={user.isAdmin ? "destructive" : "default"}
                          size="sm"
                          onClick={() => handleToggleAdmin(user.id, user.isAdmin)}
                          disabled={currentAdminUser?.id === user.id}
                          className="w-32"
                        >
                          {user.isAdmin ? (
                            <><ShieldOff className="mr-2 h-4 w-4" /> Revoke Admin</>
                          ) : (
                            <><ShieldCheck className="mr-2 h-4 w-4" /> Make Admin</>
                          )}
                        </Button>
                        <Button
                          variant={user.isSuspended ? "secondary" : "destructive"}
                          size="sm"
                          onClick={() => handleToggleSuspension(user.id, user.isSuspended)}
                          disabled={currentAdminUser?.id === user.id}
                          className="w-32"
                        >
                          {user.isSuspended ? (
                             <><Undo className="mr-2 h-4 w-4" /> Unsuspend</>
                          ) : (
                             <><Ban className="mr-2 h-4 w-4" /> Suspend</>
                          )}
                        </Button>
                      </TableCell>
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

