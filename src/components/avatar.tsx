import Image from "next/image";

/** Google profile photo, or initials when the user has no photo. */
export function Avatar({ name, image }: { name: string; image: string | null }) {
  if (image) {
    return (
      <Image
        src={image}
        alt=""
        width={64}
        height={64}
        className="h-16 w-16 rounded-full object-cover"
      />
    );
  }

  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      // Array.from splits by code point, so emoji aren't cut in half.
      .map((part) => Array.from(part)[0]!.toUpperCase())
      .join("") || "?";

  return (
    <div
      aria-hidden
      className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-200 text-xl font-semibold text-amber-900"
    >
      {initials}
    </div>
  );
}
