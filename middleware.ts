import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// ⚠️ AUTH TEMPORARILY DISABLED FOR VISUAL QA — RE-ENABLE BEFORE PRODUCTION DEPLOY
const isPublicRoute = createRouteMatcher([
  '/(.*)', // ALL routes public temporarily
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
