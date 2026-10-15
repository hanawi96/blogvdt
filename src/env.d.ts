/// <reference types="astro/client" />

import type { AdminSession } from './features/auth/session';

declare global {
  namespace App {
    interface Locals {
      adminSession: AdminSession | null;
      allowIndex?: boolean;
    }
  }
}

export {};
