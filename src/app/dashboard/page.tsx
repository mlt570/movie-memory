import { redirect } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { SignOutButton } from "@/components/sign-out-button";
import { requireUser } from "@/lib/auth";
import { FactCard } from "./fact-card";

export default async function DashboardPage() {
  const user = await requireUser(); // signed out → redirected to the landing page
  if (!user.favoriteMovie) redirect("/onboarding");

  // Google may not provide a name (or a photo); fall back gracefully.
  const displayName = user.name?.trim() || user.email || "Movie fan";

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={displayName} image={user.image} />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight">{displayName}</h1>
            {user.email && (
              <p className="truncate text-stone-600 dark:text-stone-400">{user.email}</p>
            )}
          </div>
        </div>
        <SignOutButton />
      </header>

      <section className="rounded-2xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900">
        <h2 className="text-sm font-medium uppercase tracking-wide text-stone-500">
          Favorite movie
        </h2>
        <p className="mt-1 text-2xl font-semibold">{user.favoriteMovie}</p>
      </section>

      <FactCard />
    </main>
  );
}
