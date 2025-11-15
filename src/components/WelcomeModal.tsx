import { Dialog, DialogContent } from "@/components/ui/dialog";
import { usePi } from "@/contexts/PiContext";

export default function WelcomeModal() {
  const { user, showWelcomeModal, setShowWelcomeModal } = usePi();

  if (!user) return null;

  return (
    <Dialog open={showWelcomeModal} onOpenChange={setShowWelcomeModal}>
      <DialogContent className="sm:max-w-md bg-gradient-to-br from-purple-500/10 via-pink-500/10 to-amber-500/10 border-purple-500/20">
        <div className="flex flex-col items-center justify-center py-8 space-y-4">
          <div className="text-6xl">👋</div>
          <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-amber-400 bg-clip-text text-transparent">
            Welcome!
          </h2>
          <p className="text-xl text-foreground/80">
            @{user.username}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
