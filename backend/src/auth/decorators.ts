import { SetMetadata } from '@nestjs/common';

export type UserRole = 'admin' | 'verifier' | 'project_developer' | 'corporation' | 'public';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Mark a route as publicly accessible — no JWT required. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restrict a route to one or more roles. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
