
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
import { CreditCard, Loader2, CheckCircle, QrCode, AtSign } from "lucide-react";
import type { Paper } from "@/types";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import Image from "next/image";
import LoadingSpinner from "@/components/shared/LoadingSpinner";

interface PaymentModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  paper: Paper | null;
  onPaymentSuccess: (paperId: string) => void;
}

const SUBMISSION_FEE = 50.00; 
type PaymentMethod = "card" | "upi";

export default function PaymentModal({ isOpen, onOpenChange, paper, onPaymentSuccess }: PaymentModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  
  const [cardNumber, setCardNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [cvc, setCvc] = useState("");
  const [upiId, setUpiId] = useState("");
  const [paymentStep, setPaymentStep] = useState<"form" | "success">("form");

  const resetLocalState = () => {
    setCardNumber("");
    setExpiryDate("");
    setCvc("");
    setUpiId("");
    setPaymentMethod("card");
    setPaymentStep("form");
    setIsProcessing(false); 
  };

  const handleModalVisibilityChange = (newOpenState: boolean) => {
    if (!newOpenState) {
      resetLocalState(); 
    }
    onOpenChange(newOpenState); 
  };

  const handlePayment = async () => {
    if (!paper) return;

    if (paymentMethod === "card") {
      if (!cardNumber || !expiryDate || !cvc) {
        toast({ variant: "destructive", title: "Payment Error", description: "Please fill in all card details." });
        return;
      }
    } else if (paymentMethod === "upi") {
      if (!upiId) {
          // For mock purposes, we'll allow proceeding if QR is shown, as scanning is simulated.
          // In a real app, you might require UPI ID or confirm payment through other means.
          console.log("UPI ID not entered, assuming QR scan for mock payment.");
        }
    }

    setIsProcessing(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 2000)); 
      onPaymentSuccess(paper.id);
      setPaymentStep("success");
      toast({ 
        title: "Payment Successful!", 
        description: `Your payment of $${SUBMISSION_FEE.toFixed(2)} for "${paper.title}" via ${paymentMethod === 'card' ? 'Card' : 'UPI'} has been processed.` 
      });
    } catch (error) {
      console.error("Payment processing error:", error);
      toast({ variant: "destructive", title: "Payment Failed", description: "An unexpected error occurred during payment processing." });
    } finally {
      setIsProcessing(false); 
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleModalVisibilityChange}>
      <DialogContent className="sm:max-w-md">
        {!paper && isOpen ? (
           <div className="py-10 flex flex-col items-center justify-center min-h-[200px]">
            <LoadingSpinner size={32} />
            <p className="mt-3 text-muted-foreground">Loading paper details...</p>
          </div>
        ) : paymentStep === "form" && paper ? (
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
                    <div className="p-2 border rounded-md bg-muted inline-block">
                       <Image 
                        src="https://picsum.photos/seed/upi-qr-code/120/120" 
                        alt="Scan QR Code for UPI Payment" 
                        width={120} 
                        height={120} 
                        className="rounded"
                        data-ai-hint="qr code" 
                      />
                    </div>
                     <p className="text-xs text-muted-foreground">Scan using any UPI payment app.</p>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="sm:justify-between gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => handleModalVisibilityChange(false)} disabled={isProcessing}>Cancel</Button>
              <Button onClick={handlePayment} disabled={isProcessing} className="min-w-[120px]">
                {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : (paymentMethod === 'card' ? <CreditCard className="mr-2 h-4 w-4" /> : <AtSign className="mr-2 h-4 w-4" />)}
                {isProcessing ? "Processing..." : `Pay $${SUBMISSION_FEE.toFixed(2)}`}
              </Button>
            </DialogFooter>
          </>
        ) : paymentStep === "success" && paper ? (
          <>
            <DialogHeader>
              <div className="mx-auto mb-4 h-16 w-16 text-green-500 flex items-center justify-center">
                <CheckCircle size={64} strokeWidth={1.5}/>
              </div>
              <DialogTitle className="text-2xl font-bold text-center">Payment Successful!</DialogTitle>
              <DialogDescription className="text-center px-4">
                Your paper &quot;{paper.title}&quot; has been officially submitted. You can track its status on your dashboard.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-2">
              <Button onClick={() => handleModalVisibilityChange(false)} className="w-full">Close</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

