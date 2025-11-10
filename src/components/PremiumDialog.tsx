import { Crown, Check, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useState } from "react";

interface PremiumDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PremiumDialog = ({ open, onOpenChange }: PremiumDialogProps) => {
  const [selectedPlan, setSelectedPlan] = useState<'weekly' | 'monthly' | 'yearly'>('monthly');

  const plans = [
    { id: 'weekly' as const, name: 'Weekly Plan', price: '1π', duration: '7 days access' },
    { id: 'monthly' as const, name: 'Monthly Plan', price: '3.14π', duration: '30 days access' },
    { id: 'yearly' as const, name: 'Yearly Plan', price: '31.4π', duration: '365 days access' },
  ];

  const handleActivate = () => {
    // TODO: Implement Pi Network payment integration
    console.log('Activating plan:', selectedPlan);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-full w-full h-full max-h-full m-0 p-0 border-0 bg-background flex items-center justify-center">
        <div className="relative w-full max-w-2xl mx-auto p-6 md:p-8">
          {/* Close button */}
          <button
            onClick={() => onOpenChange(false)}
            className="absolute top-4 left-4 w-10 h-10 rounded-full bg-secondary/50 hover:bg-secondary flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex flex-col items-center text-center space-y-6">
            {/* Crown Icon */}
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-b from-amber-500 via-amber-600 to-yellow-700 blur-2xl opacity-50" />
              <Crown className="w-20 h-20 md:w-24 md:h-24 relative z-10 text-amber-500" fill="currentColor" />
            </div>

            {/* Title */}
            <h2 className="text-3xl md:text-4xl font-bold text-foreground">
              Premium Version
            </h2>

            {/* Description */}
            <p className="text-muted-foreground text-sm md:text-base max-w-md">
              You'll get access to exclusive features and help improve Purple Music!
            </p>

            {/* Benefits */}
            <div className="space-y-3 w-full max-w-md">
              <div className="flex items-center gap-3 text-left">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Check className="w-4 h-4 text-primary" />
                </div>
                <span className="text-foreground">Enjoy ad-free listening</span>
              </div>
              <div className="flex items-center gap-3 text-left">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Check className="w-4 h-4 text-primary" />
                </div>
                <span className="text-foreground">Support the developer</span>
              </div>
              <div className="flex items-center gap-3 text-left">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Check className="w-4 h-4 text-primary" />
                </div>
                <span className="text-foreground">Unlock high-quality playback</span>
              </div>
              <div className="flex items-center gap-3 text-left">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Check className="w-4 h-4 text-primary" />
                </div>
                <span className="text-foreground">More features coming soon</span>
              </div>
            </div>

            {/* Plans */}
            <div className="w-full max-w-md space-y-3 pt-4">
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  onClick={() => setSelectedPlan(plan.id)}
                  className={`w-full p-4 rounded-xl border-2 transition-all ${
                    selectedPlan === plan.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-card hover:bg-accent'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-left">
                      <div className="font-semibold text-foreground">{plan.name}</div>
                      <div className="text-sm text-muted-foreground">{plan.duration}</div>
                    </div>
                    <div className="text-xl font-bold text-foreground">{plan.price}</div>
                  </div>
                </button>
              ))}
            </div>

            {/* Activate Button */}
            <button
              onClick={handleActivate}
              className="w-full max-w-md py-4 rounded-full bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-primary-foreground font-semibold text-lg transition-all hover:scale-[1.02]"
            >
              Activate {plans.find(p => p.id === selectedPlan)?.name}
            </button>

            {/* Footer note */}
            <p className="text-xs text-muted-foreground max-w-md">
              Your Pi wallet will process a one-time payment. Premium auto-expires after the selected period.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PremiumDialog;
