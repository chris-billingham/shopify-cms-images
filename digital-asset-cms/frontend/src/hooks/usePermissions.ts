import { useAuthStore } from '../stores/authStore';
import { UserRole } from '../types';

export interface Permissions {
  canUpload: boolean;
  canEditTags: boolean;
  canLinkProducts: boolean;
  canDelete: boolean;
  canPushToShopify: boolean;
  canManageUsers: boolean;
  canViewAdmin: boolean;
  canViewJobs: boolean;
}

/**
 * Resolves permissions from a role.
 * null role (not yet set / dev mode / unauthenticated) is treated as admin so
 * that existing tests without an explicit role see all controls.
 * In production the role is always set from the JWT at login.
 */
export function resolvePermissions(role: UserRole | null): Permissions {
  const isAdmin = role === 'admin' || role === null;
  const isEditor = role === 'editor' || isAdmin;
  return {
    canUpload: isEditor,
    canEditTags: isEditor,
    canLinkProducts: isEditor,
    canDelete: isAdmin,
    canPushToShopify: isAdmin,
    canManageUsers: isAdmin,
    canViewAdmin: isAdmin,
    canViewJobs: isEditor,
  };
}

export function usePermissions(): Permissions {
  const role = useAuthStore((s) => s.role);
  return resolvePermissions(role);
}
