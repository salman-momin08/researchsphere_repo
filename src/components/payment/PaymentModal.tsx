"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { CreditCard, Loader2, CheckCircle } from "lucide-react";
import type { Paper } from "@/types";

interface PaymentModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  paper: Paper | null;
  onPaymentSuccess: (paperId: string) => void;
}

// Simulate a fixed submission fee
const SUBMISSION_FEE = 50.00; // Example fee

export default function PaymentModal({ isOpen, onOpenChange, paper, onPaymentSuccess }: PaymentModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [cardNumber, setCardNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [cvc, setCvc] = useState("");
  const [paymentStep, setPaymentStep] = useState<"form" | "success">("form");

  const handlePayment = async () => {
    if (!paper) return;

    // Basic validation (in a real app, use a library like Stripe Elements)
    if (!cardNumber || !expiryDate || !cvc) {
      toast({ variant: "destructive", title: "Payment Error", description: "Please fill in all card details." });
      return;
    }

    setIsProcessing(true);
    // Simulate payment processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Simulate success
    onPaymentSuccess(paper.id);
    setPaymentStep("success");
    toast({ title: "Payment Successful!", description: `Your payment of $${SUBMISSION_FEE.toFixed(2)} for "${paper.title}" has been processed.` });
    setIsProcessing(false);
  };

  const resetAndClose = () => {
    setCardNumber("");
    setExpiryDate("");
    setCvc("");
    setPaymentStep("form");
    onOpenChange(false);
  }

  if (!paper) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) resetAndClose(); else onOpenChange(open);}}>
      <DialogContent className="sm:max-w-md">
        {paymentStep === "form" && (
          <>
            <DialogHeader>
              <div className="mx-auto mb-4 h-12 w-12 text-primary">
                <CreditCard size={48} strokeWidth={1.5}/>
              </div>
              <DialogTitle className="text-2xl font-bold text-center">Complete Your Submission</DialogTitle>
              <DialogDescription className="text-center">
                A submission fee of <strong>${SUBMISSION_FEE.toFixed(2)}</strong> is required for &quot;{paper.title}&quot;.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="cardNumber">Card Number</Label>
                <Input id="cardNumber" placeholder="•••• •••• •••• ••••" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} disabled={isProcessing} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="expiryDate">Expiry Date (MM/YY)</Label>
                  <Input id="expiryDate" placeholder="MM/YY" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} disabled={isProcessing} />
                </div>
                <div>
                  <Label htmlFor="cvc">CVC</Label>
                  <Input id="cvc" placeholder="•••" value={cvc} onChange={(e) => setCvc(e.target.value)} disabled={isProcessing} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetAndClose} disabled={isProcessing}>Cancel</Button>
              <Button onClick={handlePayment} disabled={isProcessing}>
                {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                {isProcessing ? "Processing..." : `Pay $${SUBMISSION_FEE.toFixed(2)}`}
              </Button>
            </DialogFooter>
          </>
        )}
        {paymentStep === "success" && (
          <>
            <DialogHeader>
              <div className="mx-auto mb-4 h-16 w-16 text-green-500">
                <CheckCircle size={64} strokeWidth={1.5}/>
              </div>
              <DialogTitle className="text-2xl font-bold text-center">Payment Successful!</DialogTitle>
              <DialogDescription className="text-center">
                Your paper &quot;{paper.title}&quot; has been officially submitted. You can track its status on your dashboard.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={resetAndClose}>Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
