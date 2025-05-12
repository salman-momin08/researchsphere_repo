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
  
  // Card details
  const [cardNumber, setCardNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [cvc, setCvc] = useState("");

  // UPI details
  const [upiId, setUpiId] = useState("");

  const [paymentStep, setPaymentStep] = useState<"form" | "success">("form");

  const handlePayment = async () => {
    if (!paper) return;

    if (paymentMethod === "card") {
      if (!cardNumber || !expiryDate || !cvc) {
        toast({ variant: "destructive", title: "Payment Error", description: "Please fill in all card details." });
        return;
      }
    } else if (paymentMethod === "upi") {
      if (!upiId && !confirm("You have not entered a UPI ID. Do you want to proceed assuming QR code scan? (Mock behavior)")) {
         // In a real app, you'd likely require UPI ID or scan.
         // For mock, we can allow proceeding or prompt. Here, we'll just check if empty.
        if (!upiId) {
          toast({ variant: "destructive", title: "Payment Error", description: "Please enter your UPI ID."});
          return;
        }
      }
    }

    setIsProcessing(true);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate payment processing
    
    onPaymentSuccess(paper.id);
    setPaymentStep("success");
    toast({ 
      title: "Payment Successful!", 
      description: `Your payment of $${SUBMISSION_FEE.toFixed(2)} for "${paper.title}" via ${paymentMethod === 'card' ? 'Card' : 'UPI'} has been processed.` 
    });
    setIsProcessing(false);
  };

  const resetAndClose = () => {
    setCardNumber("");
    setExpiryDate("");
    setCvc("");
    setUpiId("");
    setPaymentMethod("card"); // Reset to default payment method
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

            <div className="py-4 space-y-4">
              <div>
                <Label className="mb-2 block">Select Payment Method</Label>
                <RadioGroup
                  defaultValue="card"
                  onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}
                  className="flex space-x-4"
                  disabled={isProcessing}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="card" id="card" />
                    <Label htmlFor="card" className="flex items-center gap-2 cursor-pointer">
                      <CreditCard className="h-5 w-5" /> Credit/Debit Card
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="upi" id="upi" />
                    <Label htmlFor="upi" className="flex items-center gap-2 cursor-pointer">
                      <AtSign className="h-5 w-5" /> UPI
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {paymentMethod === "card" && (
                <div className="space-y-4 animate-in fade-in-50">
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
              )}

              {paymentMethod === "upi" && (
                <div className="space-y-4 animate-in fade-in-50">
                  <div>
                    <Label htmlFor="upiId">UPI ID</Label>
                    <Input id="upiId" placeholder="yourname@bank" value={upiId} onChange={(e) => setUpiId(e.target.value)} disabled={isProcessing} />
                  </div>
                  <div className="text-center text-muted-foreground">OR</div>
                  <div className="flex flex-col items-center space-y-2">
                    <Label>Scan QR Code</Label>
                    <div className="p-4 border rounded-md bg-muted flex items-center justify-center">
                      {/* Placeholder for QR Code Image */}
                       <Image 
                        src="https://picsum.photos/seed/qrpayment/150/150" 
                        alt="Scan QR Code for UPI Payment" 
                        width={150} 
                        height={150} 
                        className="rounded"
                        data-ai-hint="qr code" 
                      />
                    </div>
                     <p className="text-xs text-muted-foreground">Scan using any UPI app.</p>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={resetAndClose} disabled={isProcessing}>Cancel</Button>
              <Button onClick={handlePayment} disabled={isProcessing}>
                {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : (paymentMethod === 'card' ? <CreditCard className="mr-2 h-4 w-4" /> : <AtSign className="mr-2 h-4 w-4" />)}
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
