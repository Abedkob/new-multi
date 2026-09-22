import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

export function DashboardNav({
  title,
  links,
  who,
  widthClass = "max-w-5xl",
}: {
  title: string;
  links: { href: string; label: string }[];
  who: string;
  widthClass?: string;
}) {
  return (
    <header className="border-b bg-background">
      <div className={`mx-auto flex ${widthClass} flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3`}>
        <span className="font-semibold">{title}</span>
        <nav className="flex flex-1 flex-wrap items-center gap-4 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-muted-foreground hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <span className="text-sm text-muted-foreground">{who}</span>
        <form action={logoutAction}>
          <Button type="submit" variant="outline" size="sm">
            Logout
          </Button>
        </form>
      </div>
    </header>
  );
}
