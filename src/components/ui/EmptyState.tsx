import { Inbox } from "lucide-react";

type EmptyStateProps = {
  title: string;
  subtitle?: string;
  icon?: boolean;
};

export default function EmptyState({ title, subtitle, icon = true }: EmptyStateProps) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-6 text-center">
      {icon ? (
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <Inbox className="h-6 w-6" />
        </div>
      ) : null}
      <div className="text-base font-semibold text-foreground">{title}</div>
      {subtitle ? <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div> : null}
    </div>
  );
}
