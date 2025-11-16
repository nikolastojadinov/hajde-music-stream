import { Crown, Check, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useState } from "react";
import { usePi } from "@/contexts/PiContext";

interface PremiumDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PremiumDialog = ({ open, onOpenChange }: PremiumDialogProps) => {
  const [selectedPlan, setSelectedPlan] = useState<'weekly' | 'monthly' | 'yearly'>('monthly');
  const { user, sdkReady, sdkError, createPayment } = usePi();
  const [message, setMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [premiumUntil, setPremiumUntil] = useState<string | null>(null);

  const plans = [
    { id: 'weekly' as const, name: 'Weekly Plan', price: '1π', duration: '7 days access' },
    { id: 'monthly' as const, name: 'Monthly Plan', price: '3.14π', duration: '30 days access' },
    { id: 'yearly' as const, name: 'Yearly Plan', price: '31.4π', duration: '365 days access' },
  ];

  const handleActivate = async () => {
    if (!sdkReady) {
      setMessage(sdkError || 'Pi SDK is not available. Please open this app in Pi Browser.');
      return;
    }

    if (!user) {
      setMessage('Please wait for automatic authentication to complete...');
      return;
    }

    const priceMap = {
      weekly: 1,
      monthly: 3.14,
      yearly: 31.4,
    } as const;

    setIsProcessing(true);
    setMessage('Opening Pi Wallet...');
    setPremiumUntil(null);

    try {
      // Create payment with Pi SDK
      // The callbacks in PiContext will handle approve/complete automatically
      await createPayment({
        amount: priceMap[selectedPlan],
        memo: `Purple Music Premium (${selectedPlan})`,
        metadata: { 
          plan: selectedPlan, 
          user_uid: user.uid,
          username: user.username 
        },
      });

      // Payment was successful - the backend already updated premium_until
      // We just need to show success message
      setMessage('✅ Payment completed! Premium activated.');
      
      // Wait a moment then close dialog
      setTimeout(() => {
        onOpenChange(false);
        setMessage(null);
        setIsProcessing(false);
      }, 2000);

    } catch (e: any) {
      console.error('[PremiumDialog] Payment error:', e);
      setMessage(`❌ ${e.message || 'Payment failed'}`);
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-full max-h-[95vh] p-0 border border-border bg-background overflow-y-auto scrollbar-hide">
        <div className="sr-only">
          <h2 id="premium-dialog-title">Purple Music Premium</h2>
        </div>
        <div className="relative w-full mx-auto p-4 md:p-6">
          {/* Close button */}
          <button
            onClick={() => onOpenChange(false)}
            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-secondary/50 hover:bg-secondary flex items-center justify-center transition-colors z-10"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex flex-col items-center text-center space-y-4 md:space-y-5">
            {/* Crown Icon */}
            <div className="relative pt-4">
              <div className="absolute inset-0 bg-gradient-to-b from-amber-500 via-amber-600 to-yellow-700 blur-2xl opacity-50" />
              <Crown className="w-16 h-16 md:w-20 md:h-20 relative z-10 text-amber-500" fill="currentColor" />
            </div>

            {/* Title */}
            <h2 className="text-2xl md:text-3xl font-bold text-foreground">
              Premium Version
            </h2>

            {/* Description */}
            <p className="text-muted-foreground text-xs md:text-sm max-w-md px-4">
              You'll get access to exclusive features and help improve Purple Music!
            </p>

            {/* Benefits */}
            <div className="space-y-2 w-full max-w-md px-4">
              <div className="flex items-center gap-3 text-left">
                <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Check className="w-3 h-3 text-primary" />
                </div>
                <span className="text-foreground text-sm">Enjoy ad-free listening</span>
              </div>
              <div className="flex items-center gap-3 text-left">
                <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Check className="w-3 h-3 text-primary" />
                </div>
                <span className="text-foreground text-sm">Support the developer</span>
              </div>
              <div className="flex items-center gap-3 text-left">
                <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Check className="w-3 h-3 text-primary" />
                </div>
                <span className="text-foreground text-sm">More features coming soon</span>
              </div>
            </div>

            {/* Plans */}
            <div className="w-full max-w-md space-y-2 pt-2 px-4">
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  onClick={() => setSelectedPlan(plan.id)}
                  className={`w-full p-3 rounded-xl border-2 transition-all ${
                    selectedPlan === plan.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-card hover:bg-accent'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-left">
                      <div className="font-semibold text-foreground text-sm">{plan.name}</div>
                      <div className="text-xs text-muted-foreground">{plan.duration}</div>
                    </div>
                    <div className="text-lg font-bold text-foreground">{plan.price}</div>
                  </div>
                </button>
              ))}
            </div>

            {/* Activate Button */}
            <button
              onClick={handleActivate}
              className="w-full max-w-md mx-4 py-3 rounded-full bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-primary-foreground font-semibold text-base transition-all hover:scale-[1.02]"
            >
              Activate {plans.find(p => p.id === selectedPlan)?.name}
            </button>

            {message && (
              <p className="text-sm text-muted-foreground">{message}</p>
            )}

            {/* Footer note */}
            <p className="text-[10px] md:text-xs text-muted-foreground max-w-md px-4 pb-2">
              Your Pi wallet will process a one-time payment. Premium auto-expires after the selected period.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PremiumDialog;
