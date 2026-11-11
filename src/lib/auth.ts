import "server-only";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { getServerSession, type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  // Database sessions: the cookie holds only an opaque token; the session row
  // lives in Postgres and can be revoked server-side.
  session: { strategy: "database" },
  // The landing page is our sign-in page.
  pages: { signIn: "/" },
  callbacks: {
    session({ session, user }) {
      // Expose the DB user id so server code can scope queries by it.
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    // The adapter copies name/photo from Google only when the user is first
    // created. Refresh them on later sign-ins so the dashboard stays current
    // (including clearing a photo the user has since removed).
    async signIn({ user, profile, isNewUser }) {
      if (isNewUser || !profile) return;
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: { name: profile.name ?? null, image: profile.image ?? null },
        });
      } catch (error) {
        console.error("Failed to refresh Google profile", error); // never block sign-in
      }
    },
  },
};

/** The signed-in user's id, or null. The only trusted source of identity. */
export async function getSessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

export type CurrentUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  favoriteMovie: string | null;
};

/** Fetch the signed-in user's profile, or null if not signed in. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const userId = await getSessionUserId();
  if (!userId) return null;
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, image: true, favoriteMovie: true },
  });
}

/** Like getCurrentUser, but redirects to the landing (sign-in) page when signed out. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return user;
}

/** Where a signed-in user belongs: onboarding until they've picked a movie. */
export function homePathFor(user: Pick<CurrentUser, "favoriteMovie">): string {
  return user.favoriteMovie ? "/dashboard" : "/onboarding";
}
