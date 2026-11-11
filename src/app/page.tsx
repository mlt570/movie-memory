import { redirect } from "next/navigation";
import { SignInButton } from "@/components/sign-in-button";
import { getCurrentUser, homePathFor } from "@/lib/auth";

export default async function LandingPage() {
  // Signed-in users never see the landing page. This is also where Google
  // sign-in returns to, so it is the single place that decides between
  // onboarding (first-time user) and the dashboard (returning user).
  const user = await getCurrentUser();
  if (user) redirect(homePathFor(user));

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="text-5xl" aria-hidden>
        🎬
      </p>
      <h1 className="text-4xl font-bold tracking-tight">Movie Memory</h1>
      <p className="max-w-md text-stone-600 dark:text-stone-400">
        Tell us your favorite movie and we&apos;ll keep surprising you with fun facts about it.
      </p>
      <SignInButton />
    </main>
  );
}
