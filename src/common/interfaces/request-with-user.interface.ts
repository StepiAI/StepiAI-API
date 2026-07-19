import { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  email: string;
  /** Supabase auth provider used to sign in, e.g. "email" or "google". */
  provider: string;
}

export interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}
