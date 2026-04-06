import { clerkMiddleware } from '@clerk/nextjs/server';

// ⚠️ AUTH TEMPORARILY DISABLED FOR VISUAL QA — RE-ENABLE BEFORE PRODUCTION DEPLOY
// To re-enable: uncomment the createRouteMatcher and auth.protect() logic below
export default clerkMiddleware();

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
