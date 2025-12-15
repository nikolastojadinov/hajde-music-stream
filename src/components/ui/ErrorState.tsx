import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

type ErrorStateProps = {
  title: string;
  subtitle?: string;
  onRetry?: () => void;
};

export default function ErrorState({ title, subtitle, onRetry }: ErrorStateProps) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-6 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <div className="text-base font-semibold text-foreground">{title}</div>
      {subtitle ? <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div> : null}
      {onRetry ? (
        <div className="mt-4 flex justify-center">
          <Button type="button" onClick={onRetry} className="rounded-full">
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}
