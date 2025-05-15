
"use client";

import { useState, useEffect } from "react";
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
import { CreditCard, Loader2, CheckCircle, QrCode, AtSign } from "lucide-react";
import type { Paper } from "@/types";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import Image from "next/image";
import LoadingSpinner from "@/components/shared/LoadingSpinner";

interface PaymentModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  paper: Paper | null;
  onPaymentSuccess: (paperId?: string) => void;
}

const SUBMISSION_FEE = 499.00; // Updated to INR
type PaymentMethod = "card" | "upi";

export default function PaymentModal({ isOpen, onOpenChange, paper, onPaymentSuccess }: PaymentModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");

  const [cardNumber, setCardNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [cvc, setCvc] = useState("");
  const [upiId, setUpiId] = useState("");
  const [paymentStep, setPaymentStep] = useState<"form" | "success">("form");

  useEffect(() => {
    if (isOpen) {
        if(paymentStep === "form") {
            setCardNumber("");
            setExpiryDate("");
            setCvc("");
            setUpiId("");
            setPaymentMethod("card");
        }
    } else {
        setPaymentStep("form");
        setIsProcessing(false);
        setCardNumber("");
        setExpiryDate("");
        setCvc("");
        setUpiId("");
        setPaymentMethod("card");
    }
  }, [isOpen, paymentStep]);

  useEffect(() => {
    if(isOpen) {
        setPaymentStep("form");
    }
  }, [paper, isOpen]);


  const handleDialogClose = () => {
    setPaymentStep("form");
    setIsProcessing(false);
    setCardNumber("");
    setExpiryDate("");
    setCvc("");
    setUpiId("");
    setPaymentMethod("card");
    onOpenChange(false);
  };


  const handlePayment = async () => {
    if (paymentMethod === "card") {
      if (!cardNumber.trim() || !expiryDate.trim() || !cvc.trim()) {
        toast({ variant: "destructive", title: "Payment Error", description: "Please fill in all card details." });
        return;
      }
      if (!/^\d{13,19}$/.test(cardNumber.replace(/\s/g, ''))) {
         toast({ variant: "destructive", title: "Invalid Card", description: "Please enter a valid card number." });
        return;
      }
      if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiryDate)) {
         toast({ variant: "destructive", title: "Invalid Expiry", description: "Expiry date must be MM/YY." });
        return;
      }
       if (!/^\d{3,4}$/.test(cvc)) {
         toast({ variant: "destructive", title: "Invalid CVC", description: "CVC must be 3 or 4 digits." });
        return;
      }
    } else if (paymentMethod === "upi") {
      if (!upiId.trim() && !confirm("Proceed with mock UPI payment without entering UPI ID (simulating QR scan)?")) {
        return;
      }
       if (upiId.trim() && !/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(upiId)) {
         toast({ variant: "destructive", title: "Invalid UPI ID", description: "Please enter a valid UPI ID (e.g., yourname@bank)." });
        return;
      }
    }

    setIsProcessing(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));

      if (paper && paper.id) {
        onPaymentSuccess(paper.id);
      } else {
        onPaymentSuccess();
      }
      setPaymentStep("success");
    } catch (error) {
      console.error("Payment processing error:", error);
      toast({ variant: "destructive", title: "Payment Failed", description: "An unexpected error occurred during payment processing." });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleDialogClose}>
      <DialogContent className="sm:max-w-md">
        {paymentStep === "form" ? (
          <>
            <DialogHeader>
              <div className="mx-auto mb-4 h-12 w-12 text-primary">
                <CreditCard size={48} strokeWidth={1.5}/>
              </div>
              <DialogTitle className="text-2xl font-bold text-center">Complete Your Submission</DialogTitle>
              <DialogDescription className="text-center">
                A submission fee of <strong>₹{SUBMISSION_FEE.toFixed(2)}</strong> is required for
                {paper ? ` "${paper.title}"` : " your paper"}.
              </DialogDescription>
            </DialogHeader>

            <div className="py-4 space-y-4">
              <div>
                <Label className="mb-2 block font-medium">Select Payment Method</Label>
                <RadioGroup
                  value={paymentMethod}
                  onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}
                  className="flex gap-4"
                  disabled={isProcessing}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="card" id="card-method" />
                    <Label htmlFor="card-method" className="flex items-center gap-2 cursor-pointer text-sm">
                      <CreditCard className="h-5 w-5" /> Credit/Debit Card
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="upi" id="upi-method" />
                    <Label htmlFor="upi-method" className="flex items-center gap-2 cursor-pointer text-sm">
                      <AtSign className="h-5 w-5" /> UPI
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {paymentMethod === "card" && (
                <div className="space-y-3 animate-in fade-in-50">
                  <div>
                    <Label htmlFor="cardNumber">Card Number</Label>
                    <Input id="cardNumber" placeholder="0000 0000 0000 0000" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} disabled={isProcessing} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="expiryDate">Expiry Date</Label>
                      <Input id="expiryDate" placeholder="MM/YY" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} disabled={isProcessing} />
                    </div>
                    <div>
                      <Label htmlFor="cvc">CVC</Label>
                      <Input id="cvc" placeholder="123" value={cvc} onChange={(e) => setCvc(e.target.value)} disabled={isProcessing} />
                    </div>
                  </div>
                </div>
              )}

              {paymentMethod === "upi" && (
                <div className="space-y-3 animate-in fade-in-50">
                  <div>
                    <Label htmlFor="upiId">UPI ID (Optional if scanning QR)</Label>
                    <Input id="upiId" placeholder="yourname@bankupi" value={upiId} onChange={(e) => setUpiId(e.target.value)} disabled={isProcessing} />
                  </div>
                  <div className="text-center text-sm text-muted-foreground my-2">OR</div>
                  <div className="flex flex-col items-center space-y-2">
                    <Label className="font-medium">Scan QR Code</Label>
                    <div className="p-2 border rounded-md bg-white inline-block">
                       <Image
                        src="https://placehold.co/120x120/e2e8f0/e2e8f0.png?text=_" // Placeholder for QR
                        alt="Scan QR Code for UPI Payment"
                        width={120}
                        height={120}
                        className="rounded"
                        data-ai-hint="qr code payment"
                      />
                    </div>
                     <p className="text-xs text-muted-foreground">Scan using any UPI payment app.</p>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="sm:justify-between gap-2 sm:gap-0">
              <Button variant="outline" onClick={handleDialogClose} disabled={isProcessing}>Cancel</Button>
              <Button onClick={handlePayment} disabled={isProcessing} className="min-w-[120px]">
                {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : (paymentMethod === 'card' ? <CreditCard className="mr-2 h-4 w-4" /> : <AtSign className="mr-2 h-4 w-4" />)}
                {isProcessing ? "Processing..." : `Pay ₹${SUBMISSION_FEE.toFixed(2)}`}
              </Button>
            </DialogFooter>
          </>
        ) : paymentStep === "success" ? (
          <>
            <DialogHeader>
              <div className="mx-auto mb-4 h-16 w-16 text-green-500 flex items-center justify-center">
                <CheckCircle size={64} strokeWidth={1.5}/>
              </div>
              <DialogTitle className="text-2xl font-bold text-center">Payment Successful!</DialogTitle>
              <DialogDescription className="text-center px-4">
                Your payment has been successfully processed.
                {paper ? ` Your paper "${paper.title}" status will be updated.` : " Your paper will now be submitted."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-2">
              <Button onClick={handleDialogClose} className="w-full">Close</Button>
            </DialogFooter>
          </>
        ) : (
            <div className="py-10 flex flex-col items-center justify-center min-h-[200px]">
                <LoadingSpinner size={32} />
                <p className="mt-3 text-muted-foreground">Loading payment details...</p>
            </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
