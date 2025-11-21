import React, { createContext, useContext, useState, useCallback } from "react";
import PremiumDialog from "@/components/PremiumDialog";

type PremiumDialogContextValue = {
  open: boolean;
  setOpen: (value: boolean) => void;
  openDialog: () => void;
  closeDialog: () => void;
};

const PremiumDialogContext = createContext<PremiumDialogContextValue | undefined>(undefined);

export const PremiumDialogProvider = ({ children }: { children: React.ReactNode }) => {
  const [open, setOpen] = useState(false);

  const openDialog = useCallback(() => setOpen(true), []);
  const closeDialog = useCallback(() => setOpen(false), []);

  return (
    <PremiumDialogContext.Provider value={{ open, setOpen, openDialog, closeDialog }}>
      {children}
      <PremiumDialog open={open} onOpenChange={setOpen} />
    </PremiumDialogContext.Provider>
  );
};

export const usePremiumDialog = () => {
  const ctx = useContext(PremiumDialogContext);
  if (!ctx) {
    throw new Error("usePremiumDialog must be used within PremiumDialogProvider");
  }
  return ctx;
};
