
"use client";

import { useEffect, useState, useCallback } from 'react';
import type { User } from '@/types';
import { getAllUsers, toggleUserAdminStatus, toggleUserSuspensionStatus, updateUserRole } from '@/lib/user-service';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Users as UsersIcon, AlertTriangle, ShieldCheck, ShieldOff, Ban, Undo, Edit3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function UserManagementPage() {
  const { user: currentAdminUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingUserId, setProcessingUserId] = useState<string | null>(null);


  const fetchUsers = useCallback(async () => {
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
  }, [toast]); // Added toast as a dependency

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleToggleAdmin = async (targetUser: User) => {
    if (!currentAdminUser || currentAdminUser.id === targetUser.id) {
      toast({ variant: "destructive", title: "Action Not Allowed", description: "Admins cannot change their own admin status through this interface." });
      return;
    }

    if (!confirm(`Are you sure you want to ${targetUser.isAdmin ? 'revoke' : 'grant'} admin privileges for this user? This will also change their role.`)) return;
    setProcessingUserId(targetUser.id);
    try {
      await toggleUserAdminStatus(targetUser.id, !!targetUser.isAdmin);
      toast({ title: "Success", description: `User admin status and role updated.` });
      fetchUsers();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Update Failed", description: err.message || "Could not update admin status." });
    } finally {
      setProcessingUserId(null);
    }
  };

  const handleToggleSuspension = async (targetUser: User) => {
     if (!currentAdminUser || currentAdminUser.id === targetUser.id) {
      toast({ variant: "destructive", title: "Action Not Allowed", description: "Admins cannot suspend their own account through this interface." });
      return;
    }
    if (!confirm(`Are you sure you want to ${targetUser.isSuspended ? 'unsuspend' : 'suspend'} this user?`)) return;
    setProcessingUserId(targetUser.id);
    try {
      await toggleUserSuspensionStatus(targetUser.id, !!targetUser.isSuspended);
      toast({ title: "Success", description: `User suspension status updated.` });
      fetchUsers();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Update Failed", description: err.message || "Could not update user suspension status." });
    } finally {
      setProcessingUserId(null);
    }
  };

  const handleChangeRole = async (targetUserId: string, newRole: "Author" | "Reviewer") => {
    if (!currentAdminUser || currentAdminUser.id === targetUserId) {
      toast({ variant: "destructive", title: "Action Not Allowed", description: "Admins cannot change their own role through this interface." });
      return;
    }
    const targetUser = users.find(u => u.id === targetUserId);
    if (targetUser?.role === "Admin" && (newRole === "Author" || newRole === "Reviewer")) {
      if (!confirm(`This user is currently an Admin. Changing their role to ${newRole} will also revoke their admin privileges. Are you sure?`)) return;
    } else {
      if (!confirm(`Are you sure you want to change this user's role to ${newRole}?`)) return;
    }
    
    setProcessingUserId(targetUserId);
    try {
      await updateUserRole(targetUserId, newRole);
      toast({ title: "Success", description: `User role updated to ${newRole}. Admin status may have been adjusted if applicable.` });
      fetchUsers();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Role Update Failed", description: err.message || "Could not update user role." });
    } finally {
      setProcessingUserId(null);
    }
  };


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
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id} className={user.isSuspended ? "bg-destructive/10" : ""}>
                      <TableCell className="font-medium">{user.displayName || 'N/A'}</TableCell>
                      <TableCell>{user.email || 'N/A'}</TableCell>
                      <TableCell>
                        <Badge variant={user.role === "Admin" ? "default" : (user.role === "Reviewer" ? "secondary" : "outline")}>
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
                      <TableCell className="text-center">
                        <div className="flex flex-col sm:flex-row justify-center items-center gap-1 py-2">
                            <Select
                            value={user.role || undefined}
                            onValueChange={(newRole) => handleChangeRole(user.id, newRole as "Author" | "Reviewer")}
                            disabled={currentAdminUser?.id === user.id || processingUserId === user.id || user.role === "Admin"}
                            >
                            <SelectTrigger className="h-9 w-full sm:w-[150px] text-xs" aria-label={`Change role for ${user.displayName}`}>
                                <SelectValue placeholder="Change Role" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Author">Author</SelectItem>
                                <SelectItem value="Reviewer">Reviewer</SelectItem>
                            </SelectContent>
                            </Select>
                            <Button
                            variant={user.isAdmin ? "destructive" : "default"}
                            size="sm"
                            onClick={() => handleToggleAdmin(user)}
                            disabled={currentAdminUser?.id === user.id || processingUserId === user.id}
                            className="w-full sm:w-32 text-xs"
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
                            onClick={() => handleToggleSuspension(user)}
                            disabled={currentAdminUser?.id === user.id || processingUserId === user.id}
                            className="w-full sm:w-32 text-xs"
                            >
                            {user.isSuspended ? (
                                <><Undo className="mr-2 h-4 w-4" /> Unsuspend</>
                            ) : (
                                <><Ban className="mr-2 h-4 w-4" /> Suspend</>
                            )}
                            </Button>
                        </div>
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
